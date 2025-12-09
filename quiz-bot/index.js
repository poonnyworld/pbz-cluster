const {
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, EmbedBuilder, PermissionFlagsBits,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const TOKEN = process.env.QUIZ_BOT_TOKEN;
const CLIENT_ID = process.env.QUIZ_BOT_APP_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const BINGO_CHANNEL_ID = process.env.BINGO_CHANNEL_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});
const prisma = new PrismaClient();
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

// ✅ [NEW] Helper: ตัดคำให้พอดีความกว้าง (Word Wrap)
function wordWrap(str, maxWidth) {
    const res = [];
    let currentLine = "";

    // ถ้าคำยาวมากๆ ให้ตัดเลย (Character wrap) เพื่อความง่ายในตาราง
    for (let i = 0; i < str.length; i++) {
        currentLine += str[i];
        if (currentLine.length >= maxWidth) {
            res.push(currentLine);
            currentLine = "";
        }
    }
    if (currentLine.length > 0) res.push(currentLine);
    return res;
}

// ✅ [UPDATE] ตาราง Bingo แบบปัดบรรทัด (Multi-line Grid)
function generateBingoGrid(answersList) {
    const sorted = answersList.sort((a, b) => a.order - b.order);
    const colWidth = 14; // ความกว้างต่อช่อง

    let table = "```\n";
    table += "+--------------+--------------+--------------+\n";

    // Loop ทีละ 3 ข้อ (1 แถวของ Bingo)
    for (let i = 0; i < sorted.length; i += 3) {
        const rowItems = [sorted[i], sorted[i + 1], sorted[i + 2]]; // ดึงข้อมูล 3 ช่อง

        // 1. เตรียมข้อมูลข้อความของแต่ละช่อง (แบ่งเป็นบรรทัดๆ)
        const cellLines = rowItems.map(item => {
            if (!item) return []; // เผื่อแถวสุดท้ายไม่ครบ 3

            // Header: "Q1: YES" หรือ "Q1: Text..."
            let header = `Q${item.order}:`;
            let answerText = item.answer;

            // แปลง Yes/No ให้สั้นลง
            if (answerText.toLowerCase() === 'yes') answerText = 'YES';
            else if (answerText.toLowerCase() === 'no') answerText = 'NO';

            const fullText = `${header} ${answerText}`;
            return wordWrap(fullText, colWidth); // ตัดคำเป็น array ของบรรทัด
        });

        // 2. หาความสูงสูงสุดของแถวนี้ (ดูว่าช่องไหนกินบรรทัดเยอะสุด)
        const maxHeight = Math.max(
            cellLines[0] ? cellLines[0].length : 0,
            cellLines[1] ? cellLines[1].length : 0,
            cellLines[2] ? cellLines[2].length : 0
        );

        // 3. ปริ้นท์ทีละบรรทัด
        for (let line = 0; line < maxHeight; line++) {
            let lineStr = "|";
            for (let cell = 0; cell < 3; cell++) { // 3 คอลัมน์
                let text = "";
                if (cellLines[cell] && cellLines[cell][line]) {
                    text = cellLines[cell][line];
                }
                // เติมช่องว่างให้เต็มความกว้าง
                lineStr += ` ${text.padEnd(colWidth - 2)} |`; // -2 เผื่อเว้นวรรคหน้าหลัง
            }
            table += lineStr + "\n";
        }

        // จบแถว ขีดเส้นใต้
        table += "+--------------+--------------+--------------+\n";
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
            return `**Q${q.order}.** ${q.question}\nเฉลย: **${ans}**`;
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
    // 1. ADMIN COMMANDS
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'quiz-panel') {
            await interaction.deferReply({ ephemeral: true }); // ✅ Fix: ใช้ Ephemeral ไม่ให้รก
            const setId = interaction.options.getInteger('set_id');
            const payload = await createPanelPayload(setId);
            if (!payload) return interaction.editReply('❌ ไม่พบ ID นี้');

            const msg = await interaction.channel.send(payload);
            await prisma.quizSet.update({ where: { id: setId }, data: { panelMessageId: msg.id, panelChannelId: msg.channel.id } });

            await interaction.editReply('✅ สร้าง Panel สำเร็จ!');
            sendLog('📺 Panel Created', `Set ID: ${setId} in <#${msg.channel.id}>`, 0x9B59B6);
        }
        if (interaction.commandName === 'quiz-status') {
            await interaction.deferReply({ ephemeral: true });
            const setId = interaction.options.getInteger('set_id');
            const status = interaction.options.getString('status');

            if (status === 'OPEN') {
                const checkSet = await prisma.quizSet.findUnique({ where: { id: setId }, include: { questions: true } });
                if (checkSet.type === 'BINGO' && checkSet.questions.length !== 9) {
                    return interaction.editReply(`❌ **Cannot Open:** Bingo Set ต้องมีคำถามครบ **9 ข้อ** (ปัจจุบัน: ${checkSet.questions.length})`);
                }
            }

            const set = await prisma.quizSet.update({ where: { id: setId }, data: { status } });

            if (set.panelChannelId && set.panelMessageId) {
                try {
                    const channel = await client.channels.fetch(set.panelChannelId);
                    const msg = await channel.messages.fetch(set.panelMessageId);
                    await msg.edit(await createPanelPayload(setId));
                } catch (e) { console.error("Update Msg Error:", e); }
            }

            sendLog('🔄 Status Changed', `Set ID: ${setId} -> **${status}**`, 0xFFA500);

            // --- REVEALED LOGIC (Updated Grading) ---
            if (status === 'REVEALED') {
                const questions = await prisma.quizQuestion.findMany({ where: { setId } });
                const answers = await prisma.userAnswer.findMany({ where: { question: { setId } }, include: { question: true } });
                const userCorrectCount = {};

                for (const ans of answers) {
                    // 1. ✋ กรณี Manual Grading: ข้าม (เชื่อตามที่ Admin ตรวจไว้)
                    if (ans.question.manualGrading) {
                        if (ans.isCorrect === true) {
                            if (!userCorrectCount[ans.userId]) userCorrectCount[ans.userId] = 0;
                            userCorrectCount[ans.userId]++;
                        }
                        continue;
                    }

                    // 2. 🤖 กรณี Auto Grading
                    let validAnswers = [];
                    try { validAnswers = JSON.parse(ans.question.answers); } catch (e) { validAnswers = [ans.question.answers]; }
                    const validNormalized = validAnswers.map(v => v.trim().toLowerCase());
                    const userAnsNormalized = ans.answer.trim().toLowerCase();

                    // เช็คว่าถูกหรือไม่
                    const isRight = validNormalized.some(v => v === userAnsNormalized);

                    if (isRight) {
                        // ✅ [FIXED BUG] เช็คก่อนว่า "ของเดิม" เคยถูกไปแล้วหรือยัง?
                        // ถ้าของเดิมยังไม่ถูก (false หรือ null) -> ถึงจะแจกแต้มเพิ่ม
                        // ถ้าของเดิมถูกอยู่แล้ว (true) -> ไม่ต้องแจกซ้ำ
                        if (ans.isCorrect !== true) {
                            await prisma.user.upsert({
                                where: { id: ans.userId },
                                update: { souls: { increment: ans.question.rewardPoints } },
                                create: { id: ans.userId, souls: ans.question.rewardPoints }
                            });
                            console.log(`💰 Awarded points to ${ans.userId} for Q${ans.questionId}`);
                        }

                        // อัปเดตสถานะเป็นถูก
                        await prisma.userAnswer.update({ where: { id: ans.id }, data: { isCorrect: true } });

                        // นับคะแนนสำหรับ Role
                        if (!userCorrectCount[ans.userId]) userCorrectCount[ans.userId] = 0;
                        userCorrectCount[ans.userId]++;
                    } else {
                        // ถ้าผิด ก็อัปเดตเป็นผิด (และไม่ได้แต้ม)
                        await prisma.userAnswer.update({ where: { id: ans.id }, data: { isCorrect: false } });
                    }
                }

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

    // 2. USER INTERACTIONS
    if (interaction.isButton() && interaction.customId.startsWith('start_quiz_')) {
        const [, , setIdStr] = interaction.customId.split('_');
        const setId = parseInt(setIdStr);
        const set = await prisma.quizSet.findUnique({ where: { id: setId } });
        if (set.status !== 'OPEN') return interaction.reply({ content: '⛔ ปิดแล้ว', ephemeral: true });

        const existingAns = await prisma.userAnswer.findFirst({ where: { userId: interaction.user.id, question: { setId } } });
        if (existingAns) return interaction.reply({ content: '✅ คุณส่งใบทำนายไปแล้ว! รอฟังผลนะครับ', ephemeral: true });

        const sessionKey = `${interaction.user.id}_${setId}`;
        if (bingoSessions.has(sessionKey)) {
            const session = bingoSessions.get(sessionKey);
            await sendNextBingoQuestion(interaction, setId, session.currentOrder, false);
            return;
        }
        bingoSessions.set(sessionKey, { currentOrder: 1, answers: [] });
        await sendNextBingoQuestion(interaction, setId, 1, false);
    }

    if (interaction.isButton() && (interaction.customId.startsWith('bingo_yes_') || interaction.customId.startsWith('bingo_no_'))) {
        const [, choice, qIdStr, setIdStr] = interaction.customId.split('_');
        const ans = choice === 'yes' ? 'Yes' : 'No';
        await interaction.deferUpdate();
        await handleAnswer(interaction, parseInt(qIdStr), parseInt(setIdStr), ans, true);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bingo_choice_')) {
        const [, , qIdStr, setIdStr] = interaction.customId.split('_');
        const ans = interaction.values[0];
        await interaction.deferUpdate();
        await handleAnswer(interaction, parseInt(qIdStr), parseInt(setIdStr), ans, true);
    }

    if (interaction.isButton() && interaction.customId.startsWith('bingo_text_')) {
        const [, , qIdStr, setIdStr] = interaction.customId.split('_');
        const modal = new ModalBuilder().setCustomId(`modal_text_${qIdStr}_${setIdStr}`).setTitle('ระบุคำตอบ');
        const input = new TextInputBuilder().setCustomId('ans_input').setLabel('คำตอบของคุณ').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_text_')) {
        const [, , qIdStr, setIdStr] = interaction.customId.split('_');
        const ans = interaction.fields.getTextInputValue('ans_input');
        await interaction.deferUpdate();
        await handleAnswer(interaction, parseInt(qIdStr), parseInt(setIdStr), ans, false);
    }

    if (interaction.isButton() && interaction.customId.startsWith('bingo_edit_')) {
        const [, , setIdStr] = interaction.customId.split('_');
        const setId = parseInt(setIdStr);
        await interaction.deferUpdate();
        bingoSessions.set(`${interaction.user.id}_${setId}`, { currentOrder: 1, answers: [] });
        await sendNextBingoQuestion(interaction, setId, 1, true);
    }

    if (interaction.isButton() && interaction.customId.startsWith('bingo_confirm_')) {
        await interaction.deferUpdate();
        const [, , setIdStr] = interaction.customId.split('_');
        const setId = parseInt(setIdStr);
        const sessionKey = `${interaction.user.id}_${setId}`;
        const session = bingoSessions.get(sessionKey);

        if (!session || session.answers.length === 0) return interaction.editReply({ content: '❌ Error', components: [] });

        await prisma.user.upsert({ where: { id: interaction.user.id }, update: { username: interaction.user.username }, create: { id: interaction.user.id, username: interaction.user.username, souls: 0 } });
        for (const ans of session.answers) {
            const exists = await prisma.userAnswer.findUnique({ where: { userId_questionId: { userId: interaction.user.id, questionId: ans.qId } } });
            if (!exists) await prisma.userAnswer.create({ data: { userId: interaction.user.id, questionId: ans.qId, answer: ans.answer, isCorrect: false } });
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

    if (interaction.isButton() && interaction.customId.startsWith('check_result_')) {
        const setId = parseInt(interaction.customId.split('_')[2]);
        const set = await prisma.quizSet.findUnique({ where: { id: setId }, include: { questions: true } });
        const myAnswers = await prisma.userAnswer.findMany({ where: { userId: interaction.user.id, question: { setId } }, include: { question: true }, orderBy: { question: { order: 'asc' } } });

        if (myAnswers.length === 0) return interaction.reply({ content: 'ไม่พบข้อมูลการเล่น', ephemeral: true });

        let score = 0;
        let correctCount = 0;
        const details = myAnswers.map(ans => {
            let statusIcon = '❌';
            if (ans.isCorrect) { score += ans.question.rewardPoints; correctCount++; statusIcon = '✅'; }
            return `**Q${ans.question.order}:** ${statusIcon} (คุณตอบ: ${ans.answer})`;
        }).join('\n');

        let desc = `คุณได้รับรางวัลรวม: **${score} Souls**\n\n${details}`;
        if (set.completionRoleId) {
            if (correctCount === set.questions.length) desc += `\n\n🎁 **PERFECT SCORE!**\nคุณได้รับยศพิเศษ <@&${set.completionRoleId}> แล้ว!`;
            else desc += `\n\n⚠️ คุณพลาดไปนิดเดียว! (ต้องถูกครบทุกข้อถึงจะได้ยศพิเศษ)`;
        }
        const embed = new EmbedBuilder().setColor(0xF1C40F).setTitle(`🏆 ผลคะแนนของคุณ`).setDescription(desc);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

async function handleAnswer(interaction, qId, setId, answerValue, doUpdate) {
    const userId = interaction.user.id;
    const sessionKey = `${userId}_${setId}`;
    const session = bingoSessions.get(sessionKey);
    if (!session) return;

    const questionData = await prisma.quizQuestion.findUnique({ where: { id: qId } });
    session.answers.push({ qId, qText: questionData.question, answer: answerValue, order: questionData.order, reward: questionData.rewardPoints });
    session.currentOrder++;
    bingoSessions.set(sessionKey, session);

    await sendNextBingoQuestion(interaction, setId, session.currentOrder, true);
}

async function sendNextBingoQuestion(interaction, setId, order, isUpdate = false) {
    const userId = interaction.user.id;
    const session = bingoSessions.get(`${userId}_${setId}`);
    const nextQ = await prisma.quizQuestion.findFirst({ where: { setId, order: order } });

    let payload = {};

    if (nextQ) {
        const totalQ = await prisma.quizQuestion.count({ where: { setId } });
        const embed = new EmbedBuilder().setColor(0x3498DB).setTitle(`📝 คำถามข้อที่ ${nextQ.order} / ${totalQ}`).setDescription(`**${nextQ.question}**`).setFooter({ text: 'เลือก/ระบุคำตอบของคุณ' });

        let components = [];
        const type = nextQ.inputType || 'TEXT';

        if (type === 'BOOLEAN') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bingo_yes_${nextQ.id}_${setId}`).setLabel('YES').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`bingo_no_${nextQ.id}_${setId}`).setLabel('NO').setStyle(ButtonStyle.Danger)
            );
            components.push(row);
        }
        else if (type === 'CHOICE') {
            let options = [];
            try { options = JSON.parse(nextQ.options); } catch (e) { }
            if (options.length > 0) {
                const select = new StringSelectMenuBuilder().setCustomId(`bingo_choice_${nextQ.id}_${setId}`).setPlaceholder('เลือกคำตอบ...').addOptions(options.map(opt => new StringSelectMenuOptionBuilder().setLabel(opt).setValue(opt)));
                components.push(new ActionRowBuilder().addComponents(select));
            } else { embed.setDescription('⚠️ Error: No options configured.'); }
        }
        else { // TEXT
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bingo_text_${nextQ.id}_${setId}`).setLabel('🔤 พิมพ์คำตอบ').setStyle(ButtonStyle.Primary));
            components.push(row);
        }

        payload = { embeds: [embed], components: components, ephemeral: true };
    } else {
        const bingoGrid = generateBingoGrid(session.answers);
        const summaryEmbed = new EmbedBuilder().setColor(0xF1C40F).setTitle('🧐 สรุปใบทำนายของคุณ').setDescription(`ตรวจสอบความถูกต้องก่อนยืนยัน\n\n${bingoGrid}`).setFooter({ text: 'กด Confirm เพื่อส่ง หรือ Edit เพื่อเริ่มใหม่' });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bingo_confirm_${setId}`).setLabel('Confirm').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bingo_edit_${setId}`).setLabel('Edit').setStyle(ButtonStyle.Secondary)
        );
        payload = { embeds: [summaryEmbed], components: [row], ephemeral: true };
    }

    if (isUpdate) await interaction.editReply(payload);
    else await interaction.reply(payload);
}

client.login(TOKEN);