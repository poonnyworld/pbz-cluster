require('dotenv').config({ path: '../.env' });
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const cors = require('cors');
const session = require('express-session');

// --- SETUP ---
const prisma = new PrismaClient();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const TOKEN = process.env.HONOR_BOT_TOKEN;
const APP_ID = process.env.HONOR_BOT_APP_ID;
const ADMIN_USER = process.env.ADMIN_USERNAME;
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// --- HELPER: Send Log ---
async function sendLog(title, description, color = 0x0099FF) {
    if (!LOG_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (channel) {
            const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
            await channel.send({ embeds: [embed] });
        }
    } catch (e) { console.error("Log Error (Ignore if channel not set):", e.message); }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'phantom-blade-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }
}));

const requireAuth = (req, res, next) => {
    if (req.session.adminId) next();
    else res.status(401).json({ error: "Unauthorized" });
};

// ===========================
// 🏆 LEADERBOARD SYSTEM (ENGLISH + HONOR)
// ===========================
async function updateLeaderboard() {
    if (!LEADERBOARD_CHANNEL_ID) {
        console.warn("⚠️ No LEADERBOARD_CHANNEL_ID found in .env");
        return;
    }

    try {
        const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        if (!channel) {
            console.error("❌ Channel not found or bot lacks permission.");
            return;
        }

        // 1. Get Top 10
        const users = await prisma.user.findMany({
            take: 10,
            orderBy: { souls: 'desc' } // (Database field is still 'souls')
        });

        // 2. Format Message
        let desc = "";
        if (users.length === 0) {
            desc = "_No warriors have appeared yet..._";
        } else {
            users.forEach((u, index) => {
                const rank = index + 1;
                let icon = '💀';
                let medal = '';

                if (rank === 1) { icon = '👹'; medal = ' **(Grandmaster)**'; }
                if (rank === 2) { icon = '👺'; medal = ' **(Master)**'; }
                if (rank === 3) { icon = '⚔️'; medal = ' **(Elite)**'; }

                const name = u.username || 'Unknown Warrior';
                // ✅ Changed Souls -> Honor
                desc += `${icon} **Rank ${rank}** : **${name}**${medal}\n└─ 🩸 \`${u.souls}\` Honor\n\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x8B0000)
            .setTitle('📜 THE ORDER\'S BOUNTY LIST')
            .setDescription(`*List of the strongest warriors in the realm*\n\n${desc}`)
            .setImage('https://images.wallpapersden.com/image/download/phantom-blade-zero_bmdnaWmUmZqaraWkpJRmbmdlrWZlbWU.jpg')
            .setTimestamp()
            .setFooter({ text: 'Auto-updates every 1 minute • Phantom Command' });

        // 3. Edit or Send
        const messages = await channel.messages.fetch({ limit: 5 });
        const botMsg = messages.find(m => m.author.id === client.user.id);

        if (botMsg) {
            await botMsg.edit({ embeds: [embed] });
        } else {
            await channel.send({ embeds: [embed] });
        }

        console.log("✅ Leaderboard updated successfully at", new Date().toISOString());

    } catch (e) {
        console.error("Leaderboard Update Error:", e);
    }
}

// ===========================
// 🔗 API ROUTES
// ===========================

app.get('/api/download-db', requireAuth, (req, res) => {
    const fs = require('fs');
    const path = require('path');

    const possiblePaths = [
        '/app/prisma/dev.db',
        path.join(process.cwd(), 'prisma/dev.db'),
        path.join(__dirname, '../prisma/dev.db'),
        path.join(__dirname, 'prisma/dev.db')
    ];

    let dbPath = null;
    console.log("🔍 Searching for database file...");
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            dbPath = p;
            console.log(`✅ FOUND database at: ${dbPath}`);
            break;
        } else {
            console.log(`❌ Not found at: ${p}`);
        }
    }

    if (!dbPath) {
        console.error("🔥 CRITICAL: Could not find database file in any known location.");
        return res.status(500).send("Database file not found on server. Check server logs.");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.download(dbPath, `backup-${timestamp}.db`, (err) => {
        if (err) {
            console.error("❌ Download Error:", err);
            if (!res.headersSent) res.status(500).send("Error downloading file.");
        } else {
            sendLog('💾 Database Backup', 'Admin downloaded database backup.', 0x3498DB);
        }
    });
});

app.get('/api/monitor/:setId', requireAuth, async (req, res) => {
    const { setId } = req.params;
    try {
        const answers = await prisma.userAnswer.findMany({
            where: { question: { setId: parseInt(setId) } },
            include: { user: true, question: true },
            orderBy: { userId: 'asc' }
        });
        res.json(answers);
    } catch (e) { res.status(500).json({ error: "Fetch answers failed" }); }
});

app.put('/api/grade/:ansId', requireAuth, async (req, res) => {
    const { ansId } = req.params;
    const { isCorrect } = req.body;

    try {
        const oldAns = await prisma.userAnswer.findUnique({
            where: { id: parseInt(ansId) },
            include: { question: true }
        });

        if (!oldAns) return res.status(404).json({ error: "Answer not found" });

        const points = oldAns.question.rewardPoints;
        const userId = oldAns.userId;

        let soulChange = 0;
        const wasCorrect = oldAns.isCorrect === true;
        const willBeCorrect = isCorrect === true;

        if (!wasCorrect && willBeCorrect) soulChange = points;
        if (wasCorrect && !willBeCorrect) soulChange = -points;

        await prisma.userAnswer.update({
            where: { id: parseInt(ansId) },
            data: { isCorrect }
        });

        if (soulChange !== 0) {
            await prisma.user.update({
                where: { id: userId },
                data: { souls: { increment: soulChange } }
            });
        }

        res.json({ success: true, soulChange });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Grading failed" });
    }
});

// --- AUTH ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.adminId = 'session_ok';
        sendLog('🔐 Admin Login', `User: **${username}**`, 0xF1C40F);
        res.json({ success: true });
    } else res.status(401).json({ error: "Invalid credentials" });
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/check-auth', (req, res) => { res.json({ loggedIn: !!req.session.adminId }); });

// --- CONFIG ---
app.get('/api/config', async (req, res) => {
    const c = await prisma.systemConfig.findMany();
    const o = {}; c.forEach(x => o[x.key] = x.value);
    res.json(o);
});
app.post('/api/config', requireAuth, async (req, res) => {
    const { key, value } = req.body;
    await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    sendLog('⚙️ Config Change', `${key} -> ${value}`, 0xE67E22);
    res.json({ success: true });
});

// --- USERS ---
app.get('/api/users', requireAuth, async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: { souls: 'desc' } });
    res.json(users);
});
app.put('/api/users/:id', requireAuth, async (req, res) => {
    await prisma.user.update({ where: { id: req.params.id }, data: { souls: parseInt(req.body.souls) } });
    res.json({ success: true });
});

// --- QUIZ SETS ---
app.get('/api/quiz-sets', requireAuth, async (req, res) => {
    const sets = await prisma.quizSet.findMany({ include: { questions: true }, orderBy: { id: 'desc' } });
    res.json(sets);
});

app.post('/api/quiz-sets', requireAuth, async (req, res) => {
    const { title, description, completionRoleId, type } = req.body;
    try {
        const newSet = await prisma.quizSet.create({
            data: {
                title,
                description,
                completionRoleId: completionRoleId || null,
                type: type || 'BINGO'
            }
        });

        if (newSet.type === 'BINGO') {
            const questions = [];
            for (let i = 1; i <= 9; i++) {
                questions.push({
                    setId: newSet.id,
                    order: i,
                    question: `Question ${i}`,
                    answers: JSON.stringify(['Yes']),
                    inputType: 'BOOLEAN',
                    rewardPoints: 10,
                    isActive: true
                });
            }
            await prisma.quizQuestion.createMany({ data: questions });
        }

        sendLog('📚 Set Created', `**${title}** (${type})\nRole: ${completionRoleId || 'None'}`, 0x57F287);
        res.json(newSet);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Create set failed" });
    }
});

app.put('/api/quiz-sets/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description, status, completionRoleId } = req.body;

    try {
        if (status === 'OPEN') {
            const checkSet = await prisma.quizSet.findUnique({
                where: { id: parseInt(id) },
                include: { questions: true }
            });
            if (checkSet.type === 'BINGO' && checkSet.questions.length !== 9) {
                return res.status(400).json({ error: `Bingo requires exactly 9 questions (current: ${checkSet.questions.length})` });
            }
        }

        const updated = await prisma.quizSet.update({
            where: { id: parseInt(id) },
            data: { title, description, status, completionRoleId }
        });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Update failed" }); }
});

app.delete('/api/quizzes/:id', requireAuth, async (req, res) => {
    try {
        await prisma.userAnswer.deleteMany({ where: { questionId: parseInt(req.params.id) } });
        await prisma.quizQuestion.delete({ where: { id: parseInt(req.params.id) } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Delete Q failed" }); }
});

app.delete('/api/quiz-sets/:id', requireAuth, async (req, res) => {
    const setId = parseInt(req.params.id);
    try {
        const qs = await prisma.quizQuestion.findMany({ where: { setId } });
        for (const q of qs) await prisma.userAnswer.deleteMany({ where: { questionId: q.id } });
        await prisma.quizQuestion.deleteMany({ where: { setId } });
        await prisma.quizSet.delete({ where: { id: setId } });
        sendLog('🗑️ Set Deleted', `ID: ${setId}`, 0xFF0000);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

app.put('/api/quizzes/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { question, answers, rewardPoints, order, inputType, options, manualGrading } = req.body;

    try {
        const updateData = {
            question,
            rewardPoints: parseInt(rewardPoints),
            order: parseInt(order),
            inputType: inputType || 'TEXT',
            options: options || null,
            manualGrading: manualGrading || false
        };

        if (answers) {
            const ansArray = answers.split(',').map(a => a.trim());
            updateData.answers = JSON.stringify(ansArray);
        }

        const updated = await prisma.quizQuestion.update({ where: { id: parseInt(id) }, data: updateData });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Update failed" }); }
});

app.post('/api/quizzes', requireAuth, async (req, res) => {
    const { setId, question, answers, rewardPoints, order, inputType } = req.body;
    const ansArray = answers.split(',').map(a => a.trim());
    try {
        const newQ = await prisma.quizQuestion.create({
            data: {
                setId: parseInt(setId),
                question,
                answers: JSON.stringify(ansArray),
                rewardPoints: parseInt(rewardPoints),
                order: parseInt(order) || 0,
                inputType: inputType || 'TEXT'
            }
        });
        res.json(newQ);
    } catch (e) { res.status(500).json({ error: "Create Q failed" }); }
});

// --- DISCORD BOT ---
const commands = [
    // ✅ Changed description to "Honor balance"
    new SlashCommandBuilder().setName('balance').setDescription('💰 Check your Honor balance'),
];
const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
    console.log(`🗡️  Honor Bot Online`);
    if (APP_ID) await rest.put(Routes.applicationCommands(APP_ID), { body: commands });

    updateLeaderboard();
    setInterval(updateLeaderboard, 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'balance') {
        const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
        const souls = user ? user.souls : 0;
        // ✅ Changed message to "Honor"
        interaction.reply({ content: `🥷 **${interaction.user.username}**, you have **${souls}** Honor.`, ephemeral: true });
    }
});

app.listen(PORT, () => console.log(`🌐 API running on ${PORT}`));
client.login(TOKEN);