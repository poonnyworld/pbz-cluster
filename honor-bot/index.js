require('dotenv').config();
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
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID; // ✅ รับค่าจาก .env
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; // ค่าห้อง Log

// --- HELPER: Send Log ---
// ✅ ฟังก์ชันนี้ต้องอยู่ตรงนี้ ห้ามหาย!
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
// 🏆 LEADERBOARD SYSTEM (NEW)
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

        // 1. ดึง Top 10
        const users = await prisma.user.findMany({
            take: 10,
            orderBy: { souls: 'desc' }
        });

        // 2. จัดรูปแบบข้อความธีม Phantom Blade
        let desc = "";
        if (users.length === 0) {
            desc = "_ยังไม่มีจอมยุทธ์ท่านใดปรากฏกาย..._";
        } else {
            users.forEach((u, index) => {
                const rank = index + 1;
                let icon = '💀'; // อันดับทั่วไป
                let medal = '';

                // ไอคอนพิเศษสำหรับ Top 3
                if (rank === 1) { icon = '👹'; medal = ' **(Grandmaster)**'; }
                if (rank === 2) { icon = '👺'; medal = ' **(Master)**'; }
                if (rank === 3) { icon = '⚔️'; medal = ' **(Elite)**'; }

                const name = u.username || 'Unknown Warrior';
                // จัดหน้าสวยๆ
                desc += `${icon} **อันดับ ${rank}** : **${name}**${medal}\n└─ 🩸 \`${u.souls}\` Souls\n\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x8B0000) // สีแดงเลือดหมู (Blood Red)
            .setTitle('📜 THE ORDER\'S BOUNTY LIST') // ทำเนียบค่าหัว
            .setDescription(`*รายนามจอมยุทธ์ผู้แข็งแกร่งที่สุดในปฐพี*\n\n${desc}`)
            .setImage('https://images.wallpapersden.com/image/download/phantom-blade-zero_bmdnaWmUmZqaraWkpJRmbmdlrWZlbWU.jpg') // รูป PBZ เท่ๆ
            .setTimestamp()
            .setFooter({ text: 'อัปเดตอัตโนมัติทุก 1 นาที • Phantom Command' });

        // 3. หาข้อความเดิมของบอทเพื่อ Edit (ไม่ต้องลบโพสต์ใหม่)
        const messages = await channel.messages.fetch({ limit: 5 });
        const botMsg = messages.find(m => m.author.id === client.user.id);

        if (botMsg) {
            await botMsg.edit({ embeds: [embed] });
        } else {
            await channel.send({ embeds: [embed] });
        }

        // เพิ่ม Log ความสำเร็จ
        console.log("✅ Leaderboard updated successfully at", new Date().toISOString());

    } catch (e) {
        console.error("Leaderboard Update Error:", e);
    }
}

// ===========================
// 🔗 API ROUTES (Login/Users/Quiz/etc.)
// ===========================

app.get('/api/download-db', requireAuth, (req, res) => {
    const dbPath = path.join(__dirname, '../prisma/dev.db'); // ถอยกลับไป folder prisma
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.download(dbPath, `backup-${timestamp}.db`);
    sendLog('💾 Backup', 'Admin downloaded database.', 0x3498DB);
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

// ✅ Create Set (แก้ให้รับ completionRoleId ชัดเจน)
app.post('/api/quiz-sets', requireAuth, async (req, res) => {
    const { title, description, completionRoleId } = req.body;
    try {
        const newSet = await prisma.quizSet.create({
            data: {
                title,
                description,
                completionRoleId: completionRoleId || null // แปลงว่างเป็น null
            }
        });
        sendLog('📚 Set Created', `**${title}** (Role: ${completionRoleId || 'None'})`, 0x57F287);
        res.json(newSet);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Create set failed" });
    }
});

app.put('/api/quiz-sets/:id', requireAuth, async (req, res) => {
    const { title, description, status, completionRoleId } = req.body;
    try {
        const updated = await prisma.quizSet.update({
            where: { id: parseInt(req.params.id) },
            data: { title, description, status, completionRoleId }
        });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Update failed" }); }
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

// --- QUESTIONS ---
app.post('/api/quizzes', requireAuth, async (req, res) => {
    const { setId, question, answers, rewardPoints, order } = req.body;
    const ansArray = answers.split(',').map(a => a.trim());
    try {
        const newQ = await prisma.quizQuestion.create({
            data: {
                setId: parseInt(setId),
                question,
                answers: JSON.stringify(ansArray),
                rewardPoints: parseInt(rewardPoints),
                order: parseInt(order) || 0
            }
        });
        res.json(newQ);
    } catch (e) { res.status(500).json({ error: "Create Q failed" }); }
});

app.put('/api/quizzes/:id', requireAuth, async (req, res) => {
    const { question, answers, rewardPoints, order } = req.body;
    const data = { question, rewardPoints: parseInt(rewardPoints), order: parseInt(order) };
    if (answers) data.answers = JSON.stringify(answers.split(',').map(a => a.trim()));
    try {
        await prisma.quizQuestion.update({ where: { id: parseInt(req.params.id) }, data });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Update Q failed" }); }
});

app.delete('/api/quizzes/:id', requireAuth, async (req, res) => {
    try {
        await prisma.userAnswer.deleteMany({ where: { questionId: parseInt(req.params.id) } });
        await prisma.quizQuestion.delete({ where: { id: parseInt(req.params.id) } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Delete Q failed" }); }
});

// --- DISCORD BOT ---
const commands = [
    new SlashCommandBuilder().setName('balance').setDescription('💰 Check your Souls balance'),
];
const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
    console.log(`🗡️  Honor Bot Online`);

    // 👇 เพิ่ม log เช็คค่า
    console.log("DEBUG: Leaderboard Channel ID =", LEADERBOARD_CHANNEL_ID);

    if (APP_ID) await rest.put(Routes.applicationCommands(APP_ID), { body: commands });

    // ✅ เริ่มต้นระบบ Leaderboard
    console.log("🏆 Starting Leaderboard System...");
    updateLeaderboard(); // รันทันที 1 รอบ
    setInterval(updateLeaderboard, 60 * 1000); // รันทุกๆ 60 วินาที
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'balance') {
        const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
        const souls = user ? user.souls : 0;
        interaction.reply({ content: `🥷 **${interaction.user.username}**, you have **${souls}** souls.`, ephemeral: true });
    }
});

app.listen(PORT, () => console.log(`🌐 API running on ${PORT}`));
client.login(TOKEN);