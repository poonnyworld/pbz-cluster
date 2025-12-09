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
const BINGO_CHANNEL_ID = process.env.BINGO_CHANNEL_ID; // ✅ รับ ID ห้อง Bingo

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const prisma = new PrismaClient();

// ✅ Memory เก็บสถานะการตอบคำถามชั่วคราว (Key: userId_setId)
// Value: { currentOrder: 1, answers: [ {qId: 1, qText:'..', answer:'Yes', order:1}, ... ] }
const bingoSessions = new Map();

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

// --- HELPER: Generate Bingo Grid ---
function generateBingoGrid(answersList) {
    const sorted = answersList.sort((a, b) => a.order - b.order);
    let gridStr = "```\n+=================+=================+=================+\n";

    for (let i = 0; i < sorted.length; i++) {
        const q = sorted[i];
        // จัด format ให้สวยงาม (ตัดคำถามถ้ายาวเกิน)
        let qShort = q.qText.length > 12 ? q.qText.substring(0, 12) + '..' : q.qText.padEnd(14);
        let cellContent = `Q${q.order}:${q.answer.padEnd(3)} | ${qShort}`;

        gridStr += `| ${cellContent} `;

        // ขึ้นบรรทัดใหม่ทุกๆ 3 ช่อง หรือเมื่อจบตาราง
        if ((i + 1) % 3 === 0 || i === sorted.length - 1) {
            if (i === sorted.length - 1 && (i + 1) % 3 !== 0) {
                // เติมช่องว่างถ้าแถวสุดท้ายไม่ครบ 3
                const remaining = 3 - ((i + 1) % 3);
                for (let j = 0; j < remaining; j++) gridStr += `|                 `;
            }
            gridStr += "|\n+=================+=================+=================+\n";
        }
    }
    gridStr += "```";
    return gridStr;
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
    const typeText = set.type === 'BINGO' ? '🎯 Bingo Prediction' : '📝 Standard Quiz';

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
        // (ส่วน REVEALED ใช้ Logic เดิมได้ หรือปรับให้เหมาะกับ Bingo ก็ได้ ในที่นี้คงเดิมไว้ก่อน)
        const answerKey = set.questions.map(q => {
            let ans = q.answers; try { ans = JSON.parse(q.answers)[0]; } catch (e) { }
            return `**Q${q.order}.** ${q.question}\n✅ เฉลย: **${ans}** (${q.rewardPoints} Souls)`;
        }).join('\n\n');

        let desc = `🎉 **เฉลยผลการทำนาย!**\n\n${answerKey}`;
        if (set.completionRoleId) desc += `\n\n🏆 **Special Reward:** ผู้ที่ทายถูกครบทุกข้อจะได้รับยศ <@&${set.completionRoleId}>`;
        embed.setColor(0x57F287).setDescription(desc);
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

    // ---------------------------------
    // 2. USER INTERACTIONS (BINGO FLOW)
    // ---------------------------------
    if (interaction.isButton()) {
        const customId = interaction.customId;
        const userId = interaction.user.id;

        // ▶️ ปุ่มเริ่ม: Start Quiz / Bingo
        if (customId.startsWith('start_quiz_')) {
            const setId = parseInt(customId.split('_')[2]);
            const set = await prisma.quizSet.findUnique({ where: { id: setId } });

            if (set.status !== 'OPEN') return interaction.reply({ content: '⛔ กิจกรรมปิดแล้ว', ephemeral: true });

            // เช็คว่าเคยส่งไปแล้วหรือยัง
            const existingAns = await prisma.userAnswer.findFirst({ where: { userId, question: { setId } } });
            if (existingAns) return interaction.reply({ content: '✅ คุณส่งใบทำนายไปแล้ว!', ephemeral: true });

            // เริ่ม Session ใหม่ใน Memory
            bingoSessions.set(`${userId}_${setId}`, { currentOrder: 1, answers: [] });

            // ส่งคำถามข้อแรก
            await sendNextBingoQuestion(interaction, setId, 1);
        }

        // 🆗✖️ ปุ่มตอบ: Yes / No
        if (customId.startsWith('bingo_yes_') || customId.startsWith('bingo_no_')) {
            const [_, choice, qIdStr, setIdStr] = customId.split('_');
            const qId = parseInt(qIdStr);
            const setId = parseInt(setIdStr);
            const answerValue = choice === 'yes' ? 'Yes' : 'No';
            const sessionKey = `${userId}_${setId}`;
            const session = bingoSessions.get(sessionKey);

            if (!session) return interaction.reply({ content: '❌ Session หมดอายุ กรุณาเริ่มใหม่', ephemeral: true });

            // บันทึกคำตอบลง Memory
            const questionData = await prisma.quizQuestion.findUnique({ where: { id: qId } });
            session.answers.push({
                qId: qId,
                qText: questionData.question,
                answer: answerValue,
                order: questionData.order,
                reward: questionData.rewardPoints
            });
            session.currentOrder++;
            bingoSessions.set(sessionKey, session);

            // ไปข้อถัดไป หรือ หน้าสรุป
            await sendNextBingoQuestion(interaction, setId, session.currentOrder);
        }

        // ↩️ ปุ่มแก้ไข: Edit Answers (ล้าง Memory เริ่มใหม่)
        if (customId.startsWith('bingo_edit_')) {
            const setId = parseInt(customId.split('_')[2]);
            const sessionKey = `${userId}_${setId}`;
            // รีเซ็ต session
            bingoSessions.set(sessionKey, { currentOrder: 1, answers: [] });
            await interaction.update({ content: '🔄 รีเซ็ตคำตอบแล้ว เริ่มข้อ 1 ใหม่ครับ', embeds: [], components: [] });
            // ส่งข้อ 1 ใหม่ (ใช้ followUp เพราะ update ไปแล้ว)
            await sendNextBingoQuestion(interaction, setId, 1, true);
        }

        // ✅ ปุ่มยืนยัน: Confirm Submission
        if (customId.startsWith('bingo_confirm_')) {
            await interaction.deferUpdate(); // กัน timeout
            const setId = parseInt(customId.split('_')[2]);
            const sessionKey = `${userId}_${setId}`;
            const session = bingoSessions.get(sessionKey);

            if (!session || session.answers.length === 0) {
                return interaction.editReply({ content: '❌ เกิดข้อผิดพลาด กรุณาเริ่มใหม่', embeds: [], components: [] });
            }

            // 1. บันทึกลง Database จริง
            await prisma.user.upsert({ where: { id: userId }, update: { username: interaction.user.username }, create: { id: userId, username: interaction.user.username, souls: 0 } });

            for (const ans of session.answers) {
                // เช็คซ้ำอีกทีกันเหนียว
                const exists = await prisma.userAnswer.findUnique({ where: { userId_questionId: { userId, questionId: ans.qId } } });
                if (!exists) {
                    await prisma.userAnswer.create({ data: { userId, questionId: ans.qId, answer: ans.answer, isCorrect: false } });
                }
            }

            // 2. สร้าง Bingo Grid
            const bingoGrid = generateBingoGrid(session.answers);

            // 3. ส่งเข้าห้อง Bingo Channel
            if (BINGO_CHANNEL_ID) {
                const bingoEmbed = new EmbedBuilder()
                    .setTitle(`🎟️ Bingo Submission: ${interaction.user.tag}`)
                    .setDescription(`Set ID: ${setId}\n${bingoGrid}`)
                    .setColor(0x2ECC71)
                    .setTimestamp();
                await sendLog(null, null, null, BINGO_CHANNEL_ID, bingoEmbed); // ใช้ helper ส่ง embed
            }

            // 4. แจ้งเตือน User และลบ Session
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ ส่งใบทำนายเรียบร้อย!')
                .setDescription(`ระบบได้บันทึกใบ Bingo ของคุณแล้ว:\n${bingoGrid}\n\nรอลุ้นผลประกาศนะครับ!`)
                .setColor(0x57F287);

            await interaction.editReply({ embeds: [successEmbed], components: [] });
            bingoSessions.delete(sessionKey); // เคลียร์ Memory
            sendLog('🎟️ Bingo Submitted', `${interaction.user.tag} submitted for Set ${setId}`, 0x2ECC71);
        }
    }

    // ---------------------------------------------------------
    // 3. MODAL SUBMIT (ส่งคำตอบ)
    // ---------------------------------------------------------
    // if (interaction.isModalSubmit() && interaction.customId.startsWith('sub_ans_')) {
    //     const qId = parseInt(interaction.customId.split('_')[2]);
    //     const answerText = interaction.fields.getTextInputValue('ans_input').trim();

    //     // ✅ LOG: บันทึกว่า User ตอบอะไร
    //     sendLog('📝 User Answered', `**User:** ${interaction.user.tag}\n**QID:** ${qId}\n**Ans:** ${answerText}`, 0x00FFFF);

    //     await prisma.user.upsert({
    //         where: { id: interaction.user.id },
    //         update: { username: interaction.user.username },
    //         create: { id: interaction.user.id, username: interaction.user.username, souls: 0 }
    //     });

    //     const q = await prisma.quizQuestion.findUnique({ where: { id: qId } });
    //     const exists = await prisma.userAnswer.findUnique({ where: { userId_questionId: { userId: interaction.user.id, questionId: qId } } });

    //     if (!exists) {
    //         await prisma.userAnswer.create({ data: { userId: interaction.user.id, questionId: qId, answer: answerText, isCorrect: false } });
    //     }

    //     const nextQ = await getNextQuestion(interaction.user.id, q.setId);
    //     if (nextQ) {
    //         const embed = new EmbedBuilder().setColor(0x0099FF).setTitle(`📝 ข้อที่ ${nextQ.order}`).setDescription(`**${nextQ.question}**`).setFooter({ text: 'บันทึกแล้ว! ลุยข้อต่อไป' });
    //         const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ans_btn_${nextQ.id}`).setLabel('✍️ Answer').setStyle(ButtonStyle.Primary));
    //         await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    //     } else {
    //         await interaction.reply({ content: '🎉 **ส่งคำตอบครบแล้ว!** รอประกาศผลนะครับ', ephemeral: true });
    //     }
    // }
});

// --- HELPER: Send Next Question OR Summary ---
async function sendNextBingoQuestion(interaction, setId, order, isFollowUp = false) {
    const userId = interaction.user.id;
    const session = bingoSessions.get(`${userId}_${setId}`);

    // หาคำถามข้อถัดไปตาม order
    const nextQ = await prisma.quizQuestion.findFirst({
        where: { setId, order: order },
    });

    // ถ้ามีคำถามต่อไป -> แสดงปุ่ม Yes/No
    if (nextQ) {
        const totalQ = await prisma.quizQuestion.count({ where: { setId } });
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📝 คำถามข้อที่ ${nextQ.order} / ${totalQ}`)
            .setDescription(`**${nextQ.question}**`)
            .setFooter({ text: 'เลือกคำตอบของคุณ (Yes หรือ No)' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bingo_yes_${nextQ.id}_${setId}`).setLabel('✅ YES').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`bingo_no_${nextQ.id}_${setId}`).setLabel('❌ NO').setStyle(ButtonStyle.Danger)
        );

        const payload = { embeds: [embed], components: [row], ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            isFollowUp ? await interaction.followUp(payload) : await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }
    }
    // ถ้าไม่มีคำถามแล้ว -> แสดงหน้าสรุป (Summary Embed)
    else {
        const bingoGrid = generateBingoGrid(session.answers);
        const summaryEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('🧐 สรุปใบทำนายของคุณ')
            .setDescription(`กรุณาตรวจสอบความถูกต้องก่อนยืนยัน\n\n${bingoGrid}`)
            .setFooter({ text: 'กด Confirm เพื่อส่ง หรือ Edit เพื่อแก้ไขใหม่ตั้งแต่ต้น' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bingo_confirm_${setId}`).setLabel('✅ Confirm Submission').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bingo_edit_${setId}`).setLabel('↩️ Edit (Start Over)').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [summaryEmbed], components: [row], ephemeral: true });
    }
}

async function getNextQuestion(userId, setId) {
    const questions = await prisma.quizQuestion.findMany({ where: { setId, isActive: true }, orderBy: { order: 'asc' } });
    const answered = await prisma.userAnswer.findMany({ where: { userId, question: { setId } }, select: { questionId: true } });
    const answeredIds = new Set(answered.map(a => a.questionId));
    return questions.find(q => !answeredIds.has(q.id));
}

// แก้ไข function sendLog เล็กน้อยให้รองรับการส่ง Embed โดยตรง
async function sendLog(title, description, color = 0x0099FF, channelId = LOG_CHANNEL_ID, customEmbed = null) {
    if (!channelId) return;
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const embed = customEmbed || new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
            await channel.send({ embeds: [embed] });
        }
    } catch (e) { console.error(`Log Error (${channelId}):`, e.message); }
}

client.login(TOKEN);