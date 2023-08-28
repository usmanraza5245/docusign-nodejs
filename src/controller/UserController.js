const { UserModel } = require("../db/Schema/UserSchema.js");

async function createUser(name, email, company, envelopeId) {
  const data = await UserModel.create({ name, email, company, envelopeId });
  return data;
}

async function getUsers() {
  return await UserModel.find();
}
module.exports = { createUser, getUsers };
