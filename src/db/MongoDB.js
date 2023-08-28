const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const dbUrl = process.env.MONGO_DB;
    const abc = await mongoose.connect(dbUrl);
    console.log("MongoDB connected");
  } catch (error) {
    console.log(error);
    setTimeout(connectDB, 5000);
  }
};
module.exports = { connectDB };
