const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const UserModelSchema = new Schema({
  name: String,
  email: String,
  company: String,
  envelopeId: String,
  isCompleted: Boolean,
});

// Compile model from schema
const UserModel = mongoose.model("UserModel", UserModelSchema);

// export default UserModel;
module.exports = { UserModel };
