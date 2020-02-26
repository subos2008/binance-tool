const assert = require("assert");

// Configuration
const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });
// End Config

function fall_over(string) {
  console.log(`ERROR: ` + string);
  process.exit(1);
}

const launch = require("./launch");

launch();
