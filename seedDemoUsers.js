"use strict";

const mongoose = require("mongoose");
const User = require("../models/User");

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillswap";

const demoUsers = [
  {
    name: "Demo User",
    email: "demo@skillswap.io",
    password: "demo123",
    skillsOffered: ["UI Design", "Figma", "HTML/CSS"],
    skillsWanted: ["Node.js", "MongoDB"],
    bio: "Product-minded designer exploring full-stack development.",
    category: "Design",
    isAdmin: true,
    isBot: true,
  },
  {
    name: "Aarav Patel",
    email: "aarav@skillswap.io",
    password: "demo123",
    skillsOffered: ["Node.js", "Express", "API Design"],
    skillsWanted: ["UI Design", "Public Speaking"],
    bio: "Backend developer happy to mentor API fundamentals.",
    category: "Programming",
    isAdmin: false,
    isBot: true,
  },
  {
    name: "Meera Sharma",
    email: "meera@skillswap.io",
    password: "demo123",
    skillsOffered: ["Public Speaking", "Interview Prep"],
    skillsWanted: ["Data Visualization", "Python"],
    bio: "Communication coach focused on confidence and clarity.",
    category: "Career",
    isAdmin: false,
    isBot: true,
  },
  {
    name: "Rohan Iyer",
    email: "rohan@skillswap.io",
    password: "demo123",
    skillsOffered: ["Python", "Data Analysis", "SQL"],
    skillsWanted: ["Video Editing", "Branding"],
    bio: "Data enthusiast building storytelling skills for insights.",
    category: "Data",
    isAdmin: false,
    isBot: true,
  },
];

async function upsertDemoUser(seedUser) {
  const normalizedEmail = seedUser.email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail }).select("+password");

  if (!existing) {
    const created = await User.create({
      ...seedUser,
      email: normalizedEmail,
    });
    return { action: "created", user: created };
  }

  existing.name = seedUser.name;
  existing.password = seedUser.password;
  existing.skillsOffered = seedUser.skillsOffered;
  existing.skillsWanted = seedUser.skillsWanted;
  existing.bio = seedUser.bio;
  existing.category = seedUser.category;
  existing.isAdmin = Boolean(seedUser.isAdmin);
  existing.isBot = Boolean(seedUser.isBot);
  await existing.save();

  return { action: "updated", user: existing };
}

async function seedDemoUsers() {
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB at ${mongoUri}`);

  let createdCount = 0;
  let updatedCount = 0;

  for (const seedUser of demoUsers) {
    const result = await upsertDemoUser(seedUser);
    if (result.action === "created") {
      createdCount += 1;
    } else {
      updatedCount += 1;
    }

    console.log(
      `${result.action.toUpperCase()}: ${result.user.name} (${result.user.email})`
    );
  }

  const totalUsers = await User.countDocuments();
  console.log("");
  console.log("Seed completed.");
  console.log(`Created: ${createdCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Total users in DB: ${totalUsers}`);
  console.log("");
  console.log("Demo login:");
  console.log("Email: demo@skillswap.io");
  console.log("Password: demo123");
}

async function run() {
  try {
    await seedDemoUsers();
  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

run();
