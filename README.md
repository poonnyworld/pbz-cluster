# 🗡️ Phantom Blade Zero Community Bot Cluster

![Project Status](https://img.shields.io/badge/Status-Production%20Ready-success?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Enabled-blue?style=for-the-badge&logo=docker)
![Node.js](https://img.shields.io/badge/Node.js-v20-green?style=for-the-badge&logo=node.js)
![Prisma](https://img.shields.io/badge/ORM-Prisma-white?style=for-the-badge&logo=prisma)

A comprehensive, full-stack Discord bot ecosystem designed for the **Phantom Blade Zero** community. This project integrates an economy system, interactive quizzes, real-time leaderboards, and a web-based admin dashboard into a seamless experience.

---

## ✨ Key Features

### 🤖 1. Honor Bot (Economy & Core)
The central hub for user data and economy management.
* **Slash Commands:** `/balance`, `/start` (Auto-register).
* **Web Admin Dashboard:**
    * Manage Users & Points (Souls).
    * **Quiz Manager:** Create, Edit, Delete Quiz Sets & Questions.
    * **System Config:** Toggle Shop/Redeem features.
    * **Database Backup:** One-click download `.db` backup.
* **Centralized Logging:** Admin actions and system events are logged to a private Discord channel.

### ❓ 2. Quiz Bot (Interactive Events)
An advanced event management bot for "Watch Parties" and community activities.
* **Event State Management:** `OPEN` 🟢, `CLOSED` 🔴, `REVEALED` 📢.
* **Live Update Panels:** Quiz panels update in real-time without resending messages.
* **Anti-Spoiler:** User answers are hidden via Modals and stored securely.
* **Auto-Grading:** One-click `REVEALED` status automatically grades all answers and rewards "Souls".
* **Perfect Score Reward:** Automatically assigns a special **Discord Role** to users who answer all questions correctly.

### 🏆 3. Real-time Leaderboard
* **Auto-Update:** A dedicated channel displaying the Top 10 Warriors.
* **Live Sync:** Updates every minute to reflect the latest economy changes.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js
* **Framework:** Discord.js v14
* **Database:** SQLite (via Prisma ORM)
* **Backend:** Express.js (for Admin API)
* **Frontend:** HTML5/CSS3 (Vanilla JS)
* **Deployment:** Docker Compose

---

## 📸 Screenshots

| Admin Dashboard | Quiz Interaction |
| :---: | :---: |
| ![Admin Panel](https://placehold.co/600x400?text=Admin+Panel+Screenshot) | ![Quiz Modal](https://placehold.co/600x400?text=Quiz+Flow+Screenshot) |

| Leaderboard | Status Logs |
| :---: | :---: |
| ![Leaderboard](https://placehold.co/600x400?text=Leaderboard+Screenshot) | ![Logs](https://placehold.co/600x400?text=System+Logs+Screenshot) |

---

## 🚀 Installation & Deployment

### Prerequisites
* Docker & Docker Compose
* Node.js (for local development)

### 1. Clone the Repository
```bash
git clone [https://github.com/yourusername/ngerntong-bot.git](https://github.com/yourusername/pbz-cluster.git)
cd pbz-cluster
```
### 2. Environment Setup
Create a .env file in the root directory:
```.env
# Database
DATABASE_URL="file:/app/prisma/dev.db"

# 🛡️ Honor Bot
HONOR_BOT_TOKEN=your_token_here
HONOR_BOT_APP_ID=your_app_id_here
ADMIN_USERNAME='admin'
ADMIN_PASSWORD='your_secure_password'
LOG_CHANNEL_ID=your_log_channel_id
LEADERBOARD_CHANNEL_ID=your_leaderboard_channel_id

# ❓ Quiz Bot
QUIZ_BOT_TOKEN=your_quiz_token_here
QUIZ_BOT_APP_ID=your_quiz_app_id_here
```
### Run with Docker (Production)
```bash
# Build and Start containers
docker compose up -d --build

# Initialize Database Schema
docker compose exec honor-bot npx prisma db push
```
The Admin Panel will be available at http://localhost:3000 (or your VPS IP).

---

## 🎮 Commands List

### User Commands
| Command | Description |
| :--- | :--- |
| `/balance` | Check your current Souls balance. |

### Admin Commands
| Command | Description |
| :--- | :--- |
| `/quiz-panel [id]` | Spawn a permanent Quiz Embed in the channel. |
| `/quiz-status [id] [status]` | Change event status (OPEN/CLOSED/REVEALED). |

---

## 👤 Author

**Sirawitch Butryojantho**
* **Developer & System Architect**
* Created for the **Phantom Blade Zero** global community.
* Github: [@poonnyworld](https://github.com/poonnyworld/)
* Discord: `poonrighthere#7210`

---

## 📜 License
This project is created for the **Phantom Blade Zero** community.
