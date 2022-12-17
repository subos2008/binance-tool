// jest.spec.js
// Run using Jest

import { spawn } from "child_process"
import path from "node:path"

jest.setTimeout(8000)

var LineByLineReader = require("line-by-line")
// import * as LineByLineReader from "line-by-line"

describe("logger behaviour", () => {
  it("logs out multiple params - 2 strings", () => {
    const testAppFilePath = path.join(__dirname, "./logger.ts")
    const testApp = spawn("./node_modules/.bin/ts-node", [testAppFilePath])

    let lr = new LineByLineReader(testApp.stdout)

    lr.on("line", (data: string) => {
      const stdoutData = JSON.parse(data)
      expect(stdoutData.msg).toBe("Hello from .info with tags!")
      expect(stdoutData.object_type).toBe("TEST_EVENT")
      expect(stdoutData.base_asset).toBe("EVENT")
      expect(stdoutData.object_class).toBe("event")
      lr.close() // needed?
      lr.removeAllListeners() // needed?
      // testApp.disconnect() // needed?
      // testApp.kill("SIGINT") // needed?
    })
  })
})
