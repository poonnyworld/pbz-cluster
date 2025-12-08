const {
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, EmbedBuilder, PermissionFlagsBits
} = require('discord.js');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const TOKEN = process.env.QUIZ_BOT_TOKEN;
const CLIENT_ID = process.env.QUIZ_BOT_APP_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; // ✅ รับค่าห้อง Log

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const prisma = new PrismaClient();

// --- HELPER: Send Log ---
async function sendLog(title, description, color = 0x0099FF) {
    if (!LOG_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (channel) {
            const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
            await channel.send({ embeds: [embed] });
        }
    } catch (e) { console.error("Log Error:", e.message); }
}

const commands = [
    new SlashCommandBuilder()
        .setName('quiz-panel')
        .setDescription('ADMIN: สร้างป้ายกิจกรรม Quiz')
        .addIntegerOption(opt => opt.setName('set_id').setDescription('ID ของชุดข้อสอบ').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('quiz-status')
        .setDescription('ADMIN: เปลี่ยนสถานะกิจกรรม')
        .addIntegerOption(opt => opt.setName('set_id').setDescription('ID ของชุดข้อสอบ').setRequired(true))
        .addStringOption(opt => opt.setName('status').setDescription('เลือกสถานะ')
            .setRequired(true)
            .addChoices(
                { name: '🟢 OPEN (เปิดให้เล่น)', value: 'OPEN' },
                { name: '🔴 CLOSED (ปิดรับคำตอบ)', value: 'CLOSED' },
                { name: '📢 REVEALED (เฉลย & แจกรางวัล)', value: 'REVEALED' }
            ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

// --- HELPER: Create Panel ---
async function createPanelPayload(setId) {
    const set = await prisma.quizSet.findUnique({
        where: { id: setId },
        include: { questions: { orderBy: { order: 'asc' } } }
    });

    if (!set) return null;

    const embed = new EmbedBuilder().setTitle(`📜 ${set.title}`);
    const row = new ActionRowBuilder();

    if (set.status === 'OPEN') {
        embed.setColor(0xFFD700)
            .setDescription(`**✨ กิจกรรมเริ่มแล้ว!**\nตอบคำถาม ${set.questions.length} ข้อ เพื่อสะสม Souls\n\n*กดปุ่มด้านล่างเพื่อเริ่มทำข้อสอบ*`)
            .setFooter({ text: '🔴 คำเตือน: ห้ามลอกการบ้าน!' });
        row.addComponents(new ButtonBuilder().setCustomId(`start_quiz_${setId}`).setLabel('✍️ เริ่มทำข้อสอบ').setStyle(ButtonStyle.Success));
    }
    else if (set.status === 'CLOSED') {
        embed.setColor(0xED4245).setDescription(`⛔ **ปิดรับคำตอบแล้ว**\nระบบกำลังตรวจคะแนน... โปรดรอสักครู่`);
        row.addComponents(new ButtonBuilder().setCustomId(`disabled_1`).setLabel('⛔ ปิดรับคำตอบ').setStyle(ButtonStyle.Secondary).setDisabled(true));
    }
    else if (set.status === 'REVEALED') {
        const answerKey = set.questions.map(q => {
            let ans = q.answers; try { ans = JSON.parse(q.answers)[0]; } catch (e) { }
            return `**Q${q.order}.** ${q.question}\n✅ เฉลย: **${ans}** (${q.rewardPoints} Souls)`;
        }).join('\n\n');

        let desc = `🎉 **ประกาศผลคะแนน!**\n\n${answerKey}\n\n👇 **กดปุ่มด้านล่างเพื่อดูคะแนนของคุณ**`;
        if (set.completionRoleId) {
            desc += `\n\n🏆 **Special Reward:** ผู้ที่ตอบถูกครบทุกข้อจะได้รับยศ <@&${set.completionRoleId}>`;
        }

        embed.setColor(0x57F287).setDescription(desc);
        row.addComponents(new ButtonBuilder().setCustomId(`check_result_${setId}`).setLabel('🏆 ดูคะแนนของฉัน').setStyle(ButtonStyle.Primary));
    }
    else {
        embed.setColor(0x95A5A6).setDescription('⏳ กิจกรรมยังไม่พร้อม (Draft Mode)');
    }
    return { embeds: [embed], components: row.components.length > 0 ? [row] : [] };
}

// --- BOT LOGIC ---
client.once('ready', async () => {
    console.log(`✅ Quiz Bot Ready`);
    if (CLIENT_ID) await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
});

client.on('interactionCreate', async interaction => {
    // ---------------------------------------------------------
    // 1. ADMIN COMMANDS
    // ---------------------------------------------------------
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'quiz-panel') {
            await interaction.deferReply();
            const setId = interaction.options.getInteger('set_id');
            const payload = await createPanelPayload(setId);
            if (!payload) return interaction.editReply('❌ ไม่พบ Quiz Set ID นี้');
            const msg = await interaction.channel.send(payload);
            await prisma.quizSet.update({ where: { id: setId }, data: { panelMessageId: msg.id, panelChannelId: msg.channel.id } });
            await interaction.editReply({ content: '✅ สร้าง Panel สำเร็จ!' });
            sendLog('📺 Panel Created', `Set ID: ${setId} in <#${msg.channel.id}>`, 0x9B59B6);
        }

        if (commandName === 'quiz-status') {
            await interaction.deferReply({ ephemeral: true });
            const setId = interaction.options.getInteger('set_id');
            const status = interaction.options.getString('status');

            // Update DB
            const set = await prisma.quizSet.update({ where: { id: setId }, data: { status } });

            // Live Update Message
            if (set.panelChannelId && set.panelMessageId) {
                try {
                    const channel = await client.channels.fetch(set.panelChannelId);
                    const msg = await channel.messages.fetch(set.panelMessageId);
                    await msg.edit(await createPanelPayload(setId));
                } catch (e) { console.error("Update Msg Error:", e); }
            }

            sendLog('🔄 Status Changed', `Set ID: ${setId} -> **${status}**`, 0xFFA500);

            // --- REVEALED LOGIC: ตรวจคำตอบ & แจกรางวัล ---
            if (status === 'REVEALED') {
                const questions = await prisma.quizQuestion.findMany({ where: { setId } });
                const answers = await prisma.userAnswer.findMany({ where: { question: { setId } }, include: { question: true } });

                // ตัวแปรนับคะแนนรายคน: { 'userId': correctCount }
                const userCorrectCount = {};

                for (const ans of answers) {
                    let validAnswers = [];
                    try { validAnswers = JSON.parse(ans.question.answers); } catch (e) { validAnswers = [ans.question.answers]; }
                    const isRight = validAnswers.some(v => v.toLowerCase() === ans.answer.toLowerCase());

                    if (isRight) {
                        await prisma.userAnswer.update({ where: { id: ans.id }, data: { isCorrect: true } });
                        await prisma.user.upsert({
                            where: { id: ans.userId },
                            update: { souls: { increment: ans.question.rewardPoints } },
                            create: { id: ans.userId, souls: ans.question.rewardPoints }
                        });

                        // นับคะแนน
                        if (!userCorrectCount[ans.userId]) userCorrectCount[ans.userId] = 0;
                        userCorrectCount[ans.userId]++;
                    } else {
                        await prisma.userAnswer.update({ where: { id: ans.id }, data: { isCorrect: false } });
                    }
                }

                // ✅ แจก Role (ถ้ามี Role ID และตอบถูกครบ)
                if (set.completionRoleId) {
                    const totalQ = questions.length;
                    const perfectUsers = Object.keys(userCorrectCount).filter(uid => userCorrectCount[uid] === totalQ);
                    const guild = interaction.guild;

                    for (const userId of perfectUsers) {
                        try {
                            const member = await guild.members.fetch(userId);
                            await member.roles.add(set.completionRoleId);
                            console.log(`✅ Added Role to ${member.user.tag}`);
                        } catch (e) { console.error(`❌ Role Error for ${userId}:`, e.message); }
                    }
                }
            }
            await interaction.editReply(`✅ เปลี่ยนสถานะเป็น **${status}** เรียบร้อย!`);
        }
    }

    // ---------------------------------------------------------
    // 2. USER BUTTONS
    // ---------------------------------------------------------
    if (interaction.isButton()) {
        // ... (Start Quiz & Answer Button เหมือนเดิม) ...
        if (interaction.customId.startsWith('start_quiz_')) {
            const setId = parseInt(interaction.customId.split('_')[2]);
            const set = await prisma.quizSet.findUnique({ where: { id: setId } });
            if (set.status !== 'OPEN') return interaction.reply({ content: '⛔ ปิดรับคำตอบแล้ว', ephemeral: true });
            const nextQ = await getNextQuestion(interaction.user.id, setId);
            if (!nextQ) return interaction.reply({ content: '✅ ส่งคำตอบครบแล้ว รอฟังผลนะ!', ephemeral: true });
            const embed = new EmbedBuilder().setColor(0x0099FF).setTitle(`📝 ข้อที่ ${nextQ.order}`).setDescription(`**${nextQ.question}**`).setFooter({ text: 'กดปุ่ม Answer เพื่อตอบ' });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ans_btn_${nextQ.id}`).setLabel('✍️ Answer').setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
        if (interaction.customId.startsWith('ans_btn_')) {
            const qId = interaction.customId.split('_')[2];
            const modal = new ModalBuilder().setCustomId(`sub_ans_${qId}`).setTitle('ส่งคำตอบ');
            const input = new TextInputBuilder().setCustomId('ans_input').setLabel('คำตอบของคุณ').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

        // ✅ [UPDATE] Check Result Button
        if (interaction.customId.startsWith('check_result_')) {
            const setId = parseInt(interaction.customId.split('_')[2]);

            // ดึงข้อมูล Set เพื่อเอา Role ID
            const set = await prisma.quizSet.findUnique({ where: { id: setId }, include: { questions: true } });

            const myAnswers = await prisma.userAnswer.findMany({
                where: { userId: interaction.user.id, question: { setId } },
                include: { question: true },
                orderBy: { question: { order: 'asc' } }
            });

            if (myAnswers.length === 0) return interaction.reply({ content: 'ไม่พบข้อมูลการเล่น', ephemeral: true });

            let score = 0;
            let correctCount = 0;
            const details = myAnswers.map(ans => {
                if (ans.isCorrect) { score += ans.question.rewardPoints; correctCount++; }
                return `**Q${ans.question.order}:** ${ans.isCorrect ? '✅' : '❌'} (ตอบ: ${ans.answer})`;
            }).join('\n');

            let desc = `คุณได้รับรางวัลรวม: **${score} Souls**\n\n${details}`;

            // ✅ เพิ่ม Feedback ว่าได้รับ Role หรือไม่
            if (set.completionRoleId && correctCount === set.questions.length) {
                desc += `\n\n🎁 **PERFECT SCORE!**\nคุณได้รับยศพิเศษ <@&${set.completionRoleId}> แล้ว!`;
            }

            const embed = new EmbedBuilder().setColor(0xF1C40F).setTitle(`🏆 ผลคะแนนของคุณ`).setDescription(desc);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    // ---------------------------------------------------------
    // 3. MODAL SUBMIT (ส่งคำตอบ)
    // ---------------------------------------------------------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('sub_ans_')) {
        const qId = parseInt(interaction.customId.split('_')[2]);
        const answerText = interaction.fields.getTextInputValue('ans_input').trim();

        // ✅ LOG: บันทึกว่า User ตอบอะไร
        sendLog('📝 User Answered', `**User:** ${interaction.user.tag}\n**QID:** ${qId}\n**Ans:** ${answerText}`, 0x00FFFF);

        await prisma.user.upsert({
            where: { id: interaction.user.id },
            update: { username: interaction.user.username },
            create: { id: interaction.user.id, username: interaction.user.username, souls: 0 }
        });

        const q = await prisma.quizQuestion.findUnique({ where: { id: qId } });
        const exists = await prisma.userAnswer.findUnique({ where: { userId_questionId: { userId: interaction.user.id, questionId: qId } } });

        if (!exists) {
            await prisma.userAnswer.create({ data: { userId: interaction.user.id, questionId: qId, answer: answerText, isCorrect: false } });
        }

        const nextQ = await getNextQuestion(interaction.user.id, q.setId);
        if (nextQ) {
            const embed = new EmbedBuilder().setColor(0x0099FF).setTitle(`📝 ข้อที่ ${nextQ.order}`).setDescription(`**${nextQ.question}**`).setFooter({ text: 'บันทึกแล้ว! ลุยข้อต่อไป' });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ans_btn_${nextQ.id}`).setLabel('✍️ Answer').setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        } else {
            await interaction.reply({ content: '🎉 **ส่งคำตอบครบแล้ว!** รอประกาศผลนะครับ', ephemeral: true });
        }
    }
});

async function getNextQuestion(userId, setId) {
    const questions = await prisma.quizQuestion.findMany({ where: { setId, isActive: true }, orderBy: { order: 'asc' } });
    const answered = await prisma.userAnswer.findMany({ where: { userId, question: { setId } }, select: { questionId: true } });
    const answeredIds = new Set(answered.map(a => a.questionId));
    return questions.find(q => !answeredIds.has(q.id));
}

client.login(TOKEN);