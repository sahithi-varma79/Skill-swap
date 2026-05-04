"use strict";

const mongoose = require("mongoose");
const User = require("../models/User");

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillswap";
const forceMode = process.argv.includes("--force");

const reviewAuthors = [
  "Aarav",
  "Meera",
  "Rohan",
  "Aisha",
  "Neha",
  "Priya",
  "Vikram",
  "Tara",
  "Kiran",
  "Ananya",
  "Siddharth",
  "Ravi",
];

const reviewTemplates = [
  "Great session with {name}, very clear explanations.",
  "{name} was punctual and super helpful throughout.",
  "Loved the swap format, learned a lot from {name}.",
  "Well-structured guidance, highly recommend {name}.",
  "{name} made difficult topics easy to understand.",
  "Excellent communication and practical examples by {name}.",
  "Productive exchange, would definitely swap with {name} again.",
  "{name} shared strong insights and actionable tips.",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(items, index) {
  return items[index % items.length];
}

function monthStringOffset(monthsBack) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - monthsBack);
  return date.toISOString().slice(0, 7);
}

function buildReviews(userName, totalReviews, seedOffset) {
  const storedReviewCount = Math.min(totalReviews, 5);
  const firstName = String(userName || "").trim().split(/\s+/)[0] || "this user";
  const reviewsList = [];

  for (let i = 0; i < storedReviewCount; i += 1) {
    const stars = randomInt(4, 5);
    const template = pick(reviewTemplates, seedOffset + i);
    reviewsList.push({
      from: pick(reviewAuthors, seedOffset + i * 2),
      stars,
      text: template.replace("{name}", firstName),
      date: monthStringOffset(i),
    });
  }

  return reviewsList;
}

function generateRatingData(userName, seedOffset) {
  const reviews = randomInt(6, 48);
  const rating = randomInt(38, 50) / 10;

  return {
    rating,
    reviews,
    reviewsList: buildReviews(userName, reviews, seedOffset),
  };
}

async function seedUserRatings() {
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB at ${mongoUri}`);

  const users = await User.find({}).sort({ publicId: 1 });
  let updatedCount = 0;
  let alreadyRatedCount = 0;

  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    const alreadyRated = Number(user.rating || 0) > 0 && Number(user.reviews || 0) > 0;
    if (alreadyRated && !forceMode) {
      alreadyRatedCount += 1;
      continue;
    }

    const generated = generateRatingData(user.name, i + 1);
    user.rating = generated.rating;
    user.reviews = generated.reviews;
    user.reviewsList = generated.reviewsList;
    await user.save();
    updatedCount += 1;

    if (updatedCount % 200 === 0) {
      console.log(`Updated ${updatedCount} user ratings...`);
    }
  }

  const unratedCount = await User.countDocuments({
    $or: [{ rating: { $lte: 0 } }, { reviews: { $lte: 0 } }],
  });
  const totalUsers = await User.countDocuments();

  console.log("");
  console.log("Rating seed completed.");
  console.log(`Updated users: ${updatedCount}`);
  console.log(`Already rated users skipped: ${alreadyRatedCount}`);
  console.log(`Total users: ${totalUsers}`);
  console.log(`Users still unrated: ${unratedCount}`);
  if (!forceMode) {
    console.log("Tip: run with --force to regenerate ratings for everyone.");
  }
}

async function run() {
  try {
    await seedUserRatings();
  } catch (error) {
    console.error("Rating seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

run();
