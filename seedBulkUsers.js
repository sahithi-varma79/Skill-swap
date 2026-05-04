"use strict";

const mongoose = require("mongoose");
const User = require("../models/User");

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillswap";
const INSERT_BATCH_SIZE = 500;

const firstNames = [
  "Aisha",
  "Ravi",
  "Neha",
  "Arjun",
  "Priya",
  "Kiran",
  "Ananya",
  "Vikram",
  "Mehul",
  "Ira",
  "Tara",
  "Siddharth",
];

const lastNames = [
  "Nair",
  "Reddy",
  "Kapoor",
  "Singh",
  "Joshi",
  "Menon",
  "Shah",
  "Bose",
  "Malhotra",
  "Patel",
  "Saxena",
  "Gupta",
];

const offeredSkills = [
  "React",
  "Node.js",
  "Python",
  "Java",
  "UI Design",
  "Figma",
  "Excel",
  "SQL",
  "Public Speaking",
  "Content Writing",
  "Video Editing",
  "Guitar",
  "Photography",
  "Canva",
  "Digital Marketing",
  "Data Analysis",
];

const wantedSkills = [
  "MongoDB",
  "System Design",
  "C++",
  "AWS",
  "Machine Learning",
  "Animation",
  "Negotiation",
  "Branding",
  "JavaScript",
  "TypeScript",
  "Interview Prep",
  "Spanish",
  "French",
  "Product Management",
  "Cybersecurity",
  "Docker",
];

const categories = [
  "Programming",
  "Design",
  "Music",
  "Language",
  "Business",
  "Creative",
  "Other",
];

function pick(items, index) {
  return items[index % items.length];
}

function buildBalancedCategoryPool(count) {
  const basePerCategory = Math.floor(count / categories.length);
  const remainder = count % categories.length;
  const pool = [];

  for (let i = 0; i < categories.length; i += 1) {
    const repeats = basePerCategory + (i < remainder ? 1 : 0);
    for (let j = 0; j < repeats; j += 1) {
      pool.push(categories[i]);
    }
  }

  return pool;
}

function parseCountArg() {
  const raw = process.argv[2] || "100";
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid count "${raw}". Provide a positive whole number.`);
  }

  if (parsed > 50000) {
    throw new Error("Refusing to create more than 50000 users in one run.");
  }

  return parsed;
}

async function getMaxBulkIndexAndPublicId() {
  const existing = await User.find({
    email: { $regex: /^bulk\.user\.\d+@skillswap\.io$/ },
  }).select("email");
  const lastPublicIdUser = await User.findOne().sort({ publicId: -1 }).select("publicId");

  let maxIndex = 0;
  for (const user of existing) {
    const match = String(user.email).match(/^bulk\.user\.(\d+)@skillswap\.io$/);
    if (!match) {
      continue;
    }

    const currentIndex = Number(match[1]);
    if (Number.isInteger(currentIndex) && currentIndex > maxIndex) {
      maxIndex = currentIndex;
    }
  }

  return {
    maxIndex,
    existingBulkCount: existing.length,
    maxPublicId: lastPublicIdUser?.publicId || 0,
  };
}

function buildUser(index, category, publicId) {
  const firstName = pick(firstNames, index - 1);
  const lastName = pick(lastNames, Math.floor((index - 1) / firstNames.length));
  const offerA = pick(offeredSkills, index - 1);
  const offerB = pick(offeredSkills, index + 7);
  const wantA = pick(wantedSkills, index + 2);
  const wantB = pick(wantedSkills, index + 9);

  return {
    publicId,
    name: `${firstName} ${lastName} ${index}`,
    email: `bulk.user.${String(index).padStart(4, "0")}@skillswap.io`,
    password: "demo123",
    skillsOffered: [offerA, offerB],
    skillsWanted: [wantA, wantB],
    bio: `Hi, I can help with ${offerA} and ${offerB}. I want to learn ${wantA}.`,
    category,
    isAdmin: false,
    isBot: true,
  };
}

async function seedBulkUsers(count) {
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB at ${mongoUri}`);

  const totalBefore = await User.countDocuments();
  const { maxIndex, existingBulkCount, maxPublicId } = await getMaxBulkIndexAndPublicId();
  const categoryPool = buildBalancedCategoryPool(count);
  const createdCategoryCounts = {};

  let created = 0;
  let nextBulkIndex = maxIndex + 1;
  let nextPublicId = maxPublicId + 1;
  let pendingBatch = [];

  for (let i = 0; i < count; i += 1) {
    const category = categoryPool[i];
    const user = buildUser(nextBulkIndex, category, nextPublicId);
    pendingBatch.push(user);
    nextBulkIndex += 1;
    nextPublicId += 1;
    createdCategoryCounts[category] = (createdCategoryCounts[category] || 0) + 1;

    if (pendingBatch.length === INSERT_BATCH_SIZE || i === count - 1) {
      await User.insertMany(pendingBatch);
      created += pendingBatch.length;
      pendingBatch = [];
    }

    if (created > 0 && (created % 500 === 0 || created === count)) {
      console.log(`Created ${created}/${count} users...`);
    }
  }

  const totalAfter = await User.countDocuments();
  const addedRangeStart = maxIndex + 1;
  const addedRangeEnd = maxIndex + count;

  console.log("");
  console.log("Bulk seed completed.");
  console.log(`Existing bulk users before run: ${existingBulkCount}`);
  console.log(`Created in this run: ${created}`);
  console.log(`New bulk user index range: ${addedRangeStart} to ${addedRangeEnd}`);
  console.log(`Total users before: ${totalBefore}`);
  console.log(`Total users after: ${totalAfter}`);
  console.log("");
  console.log("Category distribution in this run:");
  for (const category of categories) {
    console.log(`- ${category}: ${createdCategoryCounts[category] || 0}`);
  }
}

async function run() {
  try {
    const count = parseCountArg();
    await seedBulkUsers(count);
  } catch (error) {
    console.error("Bulk seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

run();
