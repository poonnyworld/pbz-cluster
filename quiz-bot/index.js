const {
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, EmbedBuilder, PermissionFlagsBits
} = require('discord.js');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const TOKEN = process.env.QUIZ_BOT_TOKEN;
const CLIENT_ID = process.env.QUIZ_BOT_APP_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const BINGO_CHANNEL_ID = process.env.BINGO_CHANNEL_ID;

// ✅ 1. เพิ่ม GuildMembers เพื่อให้แจกยศได้ชัวร์ๆ
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});
const prisma = new PrismaClient();

// Memory เก็บสถานะ (Resume System)
const bingoSessions = new Map();

// --- HELPER: Send Log ---
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

// ✅ 2. ตาราง Bingo แบบสวย (3x3 Grid)
function generateBingoGrid(answersList) {
    // เรียงตามข้อ 1-9
    const sorted = answersList.sort((a, b) => a.order - b.order);

    let table = "```\n";
    table += "+----------+----------+----------+\n"; // เส้นบน

    let rowLine = "";
    sorted.forEach((ans, index) => {
        // จัดข้อความให้กลางๆ: " Q1: YES  "
        const ansText = ans.answer === 'Yes' ? 'YES' : 'NO ';
        const cell = ` Q${ans.order}:${ansText} `.padEnd(10);

        rowLine += `|${cell}`;

        // ตัดบรรทัดทุก 3 ช่อง หรือ จบ
        if ((index + 1) % 3 === 0) {
            table += rowLine + "|\n";
            table += "+----------+----------+----------+\n";
            rowLine = "";
        }
    });

    // ถ้าจบแล้วแถวสุดท้ายไม่เต็ม 3 ช่อง ให้เติมว่างๆ
    if (rowLine !== "") {
        while (rowLine.length < 33) rowLine += "|          "; // 33 คือความยาว 3 ช่องรวมเส้น
        table += rowLine + "|\n";
        table += "+----------+----------+----------+\n";
    }

    table += "```";
    return table;
}

// --- COMMANDS ---
const commands = [
    new SlashCommandBuilder().setName('quiz-panel').setDescription('ADMIN: สร้างป้ายกิจกรรม Quiz').addIntegerOption(opt => opt.setName('set_id').setDescription('ID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('quiz-status').setDescription('ADMIN: เปลี่ยนสถานะ').addIntegerOption(opt => opt.setName('set_id').setDescription('ID').setRequired(true)).addStringOption(opt => opt.setName('status').setDescription('Status').setRequired(true).addChoices({ name: 'OPEN', value: 'OPEN' }, { name: 'CLOSED', value: 'CLOSED' }, { name: 'REVEALED', value: 'REVEALED' })).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];
const rest = new REST({ version: '10' }).setToken(TOKEN);

// --- PANEL HELPER ---
async function createPanelPayload(setId) {
    const set = await prisma.quizSet.findUnique({ where: { id: setId }, include: { questions: { orderBy: { order: 'asc' } } } });
    if (!set) return null;
    const embed = new EmbedBuilder().setTitle(`📜 ${set.title}`);
    const row = new ActionRowBuilder();
    const typeText = set.type === 'BINGO' ? '🎯 Bingo Prediction' : '📝 Standard Quiz';

    if (set.status === 'OPEN') {
        embed.setColor(0xFFD700).setDescription(`**✨ กิจกรรมเริ่มแล้ว! (${typeText})**\nตอบคำถาม ${set.questions.length} ข้อ เพื่อสร้างใบทำนาย\n\n*กดปุ่มด้านล่างเพื่อเริ่ม (ถ้าเผลอปิด กดใหม่เพื่อทำต่อได้)*`).setFooter({ text: '🔴 คำเตือน: คิดให้ดีก่อนตอบ!' });
        row.addComponents(new ButtonBuilder().setCustomId(`start_quiz_${setId}`).setLabel('✍️ เริ่มกิจกรรม / ทำต่อ').setStyle(ButtonStyle.Success));
    } else if (set.status === 'CLOSED') {
        embed.setColor(0xED4245).setDescription(`⛔ **ปิดรับคำตอบแล้ว**\nรอติดตามผลการทำนายได้เร็วๆ นี้!`);
        row.addComponents(new ButtonBuilder().setCustomId(`disabled_1`).setLabel('⛔ ปิดรับคำตอบ').setStyle(ButtonStyle.Secondary).setDisabled(true));
    } else if (set.status === 'REVEALED') {
        const answerKey = set.questions.map(q => {
            let ans = q.answers; try { ans = JSON.parse(q.answers)[0]; } catch (e) { }
            // แปลง Yes/No ให้ดูง่าย
            const displayAns = ans.toLowerCase() === 'yes' ? '✅ YES' : '❌ NO';
            return `**Q${q.order}.** ${q.question}\nเฉลย: **${displayAns}**`;
        }).join('\n\n');
        let desc = `🎉 **เฉลยผลการทำนาย!**\n\n${answerKey}`;
        if (set.completionRoleId) desc += `\n\n🏆 **Special Reward:** ผู้ที่ทายถูกครบทุกข้อจะได้รับยศ <@&${set.completionRoleId}>`;
        embed.setColor(0x57F287).setDescription(desc);
        row.addComponents(new ButtonBuilder().setCustomId(`check_result_${setId}`).setLabel('🏆 ดูคะแนนของฉัน').setStyle(ButtonStyle.Primary));
    } else {
        embed.setColor(0x95A5A6).setDescription('⏳ กิจกรรมยังไม่พร้อม (Draft Mode)');
    }
    return { embeds: [embed], components: row.components.length > 0 ? [row] : [] };
}

// --- BOT MAIN ---
client.once('ready', async () => {
    console.log(`✅ Bingo Bot Ready`);
    if (CLIENT_ID) await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
});

client.on('interactionCreate', async interaction => {
    // 1. ADMIN
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'quiz-panel') {
            await interaction.deferReply();
            const setId = interaction.options.getInteger('set_id');
            const payload = await createPanelPayload(setId);
            if (!payload) return interaction.editReply('❌ ไม่พบ ID นี้');
            const msg = await interaction.channel.send(payload);
            await prisma.quizSet.update({ where: { id: setId }, data: { panelMessageId: msg.id, panelChannelId: msg.channel.id } });
            await interaction.editReply('✅ สร้าง Panel สำเร็จ!');
        }
        if (interaction.commandName === 'quiz-status') {
            await interaction.deferReply({ ephemeral: true });
            const setId = interaction.options.getInteger('set_id');
            const status = interaction.options.getString('status');

            // ✅ [NEW] Validation: เช็คจำนวนข้อก่อนเปิด
            if (status === 'OPEN') {
                const checkSet = await prisma.quizSet.findUnique({
                    where: { id: setId },
                    include: { questions: true }
                });

                if (checkSet.type === 'BINGO' && checkSet.questions.length !== 9) {
                    return interaction.editReply(`❌ **Cannot Open:** Bingo Set ต้องมีคำถามครบ **9 ข้อ** เท่านั้นครับ (ปัจจุบันมี ${checkSet.questions.length} ข้อ)`);
                }
            }

            // อัปเดตสถานะ
            const set = await prisma.quizSet.update({ where: { id: setId }, data: { status } });

            // Live Update Message
            if (set.panelChannelId && set.panelMessageId) {
                try {
                    const channel = await client.channels.fetch(set.panelChannelId);
                    const msg = await channel.messages.fetch(set.panelMessageId);
                    await msg.edit(await createPanelPayload(setId));
                } catch (e) { console.error("Update Msg Error:", e); }
            }

            // --- REVEALED LOGIC: ตรวจคำตอบ & แจกแต้ม/ยศ ---
            if (status === 'REVEALED') {
                const questions = await prisma.quizQuestion.findMany({ where: { setId } });
                const answers = await prisma.userAnswer.findMany({ where: { question: { setId } }, include: { question: true } });
                const userCorrectCount = {};

                for (const ans of answers) {
                    // ดึงเฉลยจาก DB (ซึ่ง Admin ต้องแก้ให้ถูกก่อนกด Reveal)
                    let validAnswers = [];
                    try { validAnswers = JSON.parse(ans.question.answers); } catch (e) { validAnswers = [ans.question.answers]; }

                    // เปรียบเทียบ (Case Insensitive: "Yes" == "yes")
                    const isRight = validAnswers.some(v => v.toLowerCase() === ans.answer.toLowerCase());

                    if (isRight) {
                        // 1. Mark as Correct
                        await prisma.userAnswer.update({ where: { id: ans.id }, data: { isCorrect: true } });

                        // 2. Give Points (Souls)
                        await prisma.user.upsert({
                            where: { id: ans.userId },
                            update: { souls: { increment: ans.question.rewardPoints } },
                            create: { id: ans.userId, souls: ans.question.rewardPoints }
                        });

                        // 3. Count for Role
                        if (!userCorrectCount[ans.userId]) userCorrectCount[ans.userId] = 0;
                        userCorrectCount[ans.userId]++;
                    } else {
                        await prisma.userAnswer.update({ where: { id: ans.id }, data: { isCorrect: false } });
                    }
                }

                // แจก Role
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
            await interaction.editReply(`✅ Status -> **${status}**`);
        }
    }

    // 2. USER ACTIONS
    if (interaction.isButton()) {
        const customId = interaction.customId;
        const userId = interaction.user.id;

        // ▶️ Start / Resume Logic (แก้เรื่องเผลอปิด)
        if (customId.startsWith('start_quiz_')) {
            const setId = parseInt(customId.split('_')[2]);
            const set = await prisma.quizSet.findUnique({ where: { id: setId } });
            if (set.status !== 'OPEN') return interaction.reply({ content: '⛔ ปิดแล้ว', ephemeral: true });

            // 1. เช็คว่าส่งไปแล้วหรือยัง
            const existingAns = await prisma.userAnswer.findFirst({ where: { userId, question: { setId } } });
            if (existingAns) return interaction.reply({ content: '✅ คุณส่งใบทำนายไปแล้ว! รอฟังผลนะครับ', ephemeral: true });

            // 2. เช็ค Session ค้าง (Resume)
            const sessionKey = `${userId}_${setId}`;
            if (bingoSessions.has(sessionKey)) {
                const session = bingoSessions.get(sessionKey);
                // ส่งข้อปัจจุบันต่อเลย
                await sendNextBingoQuestion(interaction, setId, session.currentOrder, false);
                return;
            }

            // 3. เริ่มใหม่
            bingoSessions.set(sessionKey, { currentOrder: 1, answers: [] });
            await sendNextBingoQuestion(interaction, setId, 1, false);
        }

        // 🆗✖️ Answer (Yes/No)
        if (customId.startsWith('bingo_yes_') || customId.startsWith('bingo_no_')) {
            const [_, choice, qIdStr, setIdStr] = customId.split('_');
            const qId = parseInt(qIdStr);
            const setId = parseInt(setIdStr);
            const answerValue = choice === 'yes' ? 'Yes' : 'No';
            const sessionKey = `${userId}_${setId}`;
            const session = bingoSessions.get(sessionKey);

            if (!session) return interaction.reply({ content: '❌ Session หมดอายุ กรุณากดปุ่มเริ่มที่หน้า Panel ใหม่', ephemeral: true });

            const questionData = await prisma.quizQuestion.findUnique({ where: { id: qId } });
            session.answers.push({ qId, qText: questionData.question, answer: answerValue, order: questionData.order, reward: questionData.rewardPoints });
            session.currentOrder++;
            bingoSessions.set(sessionKey, session);

            await sendNextBingoQuestion(interaction, setId, session.currentOrder, true); // ใช้ update
        }

        // ↩️ Edit (Reset)
        if (customId.startsWith('bingo_edit_')) {
            const setId = parseInt(customId.split('_')[2]);
            const sessionKey = `${userId}_${setId}`;
            bingoSessions.set(sessionKey, { currentOrder: 1, answers: [] });
            await sendNextBingoQuestion(interaction, setId, 1, true); // update กลับไปข้อ 1
        }

        // ✅ Confirm
        if (customId.startsWith('bingo_confirm_')) {
            await interaction.deferUpdate();
            const setId = parseInt(customId.split('_')[2]);
            const sessionKey = `${userId}_${setId}`;
            const session = bingoSessions.get(sessionKey);

            if (!session || session.answers.length === 0) return interaction.editReply({ content: '❌ Error', components: [] });

            // บันทึก DB
            await prisma.user.upsert({ where: { id: userId }, update: { username: interaction.user.username }, create: { id: userId, username: interaction.user.username, souls: 0 } });
            for (const ans of session.answers) {
                const exists = await prisma.userAnswer.findUnique({ where: { userId_questionId: { userId, questionId: ans.qId } } });
                if (!exists) await prisma.userAnswer.create({ data: { userId, questionId: ans.qId, answer: ans.answer, isCorrect: false } });
            }

            const bingoGrid = generateBingoGrid(session.answers);
            if (BINGO_CHANNEL_ID) {
                const bingoEmbed = new EmbedBuilder().setTitle(`🎟️ Bingo: ${interaction.user.tag}`).setDescription(`Set ID: ${setId}\n${bingoGrid}`).setColor(0x2ECC71).setTimestamp();
                await sendLog(null, null, null, BINGO_CHANNEL_ID, bingoEmbed);
            }

            const successEmbed = new EmbedBuilder().setTitle('✅ ส่งใบทำนายเรียบร้อย!').setDescription(`ระบบบันทึกใบ Bingo แล้ว:\n${bingoGrid}\n\nรอลุ้นผลประกาศ!`).setColor(0x57F287);

            await interaction.editReply({ embeds: [successEmbed], components: [] });
            bingoSessions.delete(sessionKey);
        }

        // 🏆 Check Result (เพิ่มแสดงยศที่ได้รับ)
        if (interaction.customId.startsWith('check_result_')) {
            const setId = parseInt(interaction.customId.split('_')[2]);
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
                let statusIcon = '❌';
                if (ans.isCorrect) { score += ans.question.rewardPoints; correctCount++; statusIcon = '✅'; }
                return `**Q${ans.question.order}:** ${statusIcon} (คุณตอบ: ${ans.answer})`;
            }).join('\n');

            let desc = `คุณได้รับรางวัลรวม: **${score} Souls**\n\n${details}`;

            // Feedback เรื่อง Role
            if (set.completionRoleId) {
                if (correctCount === set.questions.length) {
                    desc += `\n\n🎁 **PERFECT SCORE!**\nคุณได้รับยศพิเศษ <@&${set.completionRoleId}> แล้ว!`;
                } else {
                    desc += `\n\n⚠️ คุณพลาดไปนิดเดียว! (ต้องถูกครบทุกข้อถึงจะได้ยศพิเศษ)`;
                }
            }

            const embed = new EmbedBuilder().setColor(0xF1C40F).setTitle(`🏆 ผลคะแนนของคุณ`).setDescription(desc);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
});

async function sendNextBingoQuestion(interaction, setId, order, isUpdate = false) {
    const userId = interaction.user.id;
    const session = bingoSessions.get(`${userId}_${setId}`);
    const nextQ = await prisma.quizQuestion.findFirst({ where: { setId, order: order } });

    let payload = {};

    if (nextQ) {
        const totalQ = await prisma.quizQuestion.count({ where: { setId } });
        const embed = new EmbedBuilder().setColor(0x3498DB).setTitle(`📝 คำถามข้อที่ ${nextQ.order} / ${totalQ}`).setDescription(`**${nextQ.question}**`).setFooter({ text: 'เลือกคำตอบของคุณ' });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bingo_yes_${nextQ.id}_${setId}`).setLabel('YES').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`bingo_no_${nextQ.id}_${setId}`).setLabel('NO').setStyle(ButtonStyle.Danger)
        );
        payload = { embeds: [embed], components: [row], ephemeral: true };
    } else {
        const bingoGrid = generateBingoGrid(session.answers);
        const summaryEmbed = new EmbedBuilder().setColor(0xF1C40F).setTitle('🧐 สรุปใบทำนายของคุณ').setDescription(`ตรวจสอบความถูกต้องก่อนยืนยัน\n\n${bingoGrid}`).setFooter({ text: 'กด Confirm เพื่อส่ง หรือ Edit เพื่อเริ่มใหม่' });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bingo_confirm_${setId}`).setLabel('Confirm').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bingo_edit_${setId}`).setLabel('Edit').setStyle(ButtonStyle.Secondary)
        );
        payload = { embeds: [summaryEmbed], components: [row], ephemeral: true };
    }

    if (isUpdate) await interaction.update(payload);
    else await interaction.reply(payload);
}

client.login(TOKEN);