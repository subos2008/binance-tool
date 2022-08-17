// jest.spec.js
// Run using Jest

import { spawn } from "child_process"
import path from "node:path"
// import * as LineByLineReader from 'line-by-line'

var LineByLineReader = require("line-by-line")

describe("logger behaviour", () => {
  it("logs out multiple params - 2 strings", (done) => {
    const testAppFilePath = path.join(__dirname, "./logger.ts")
    const testApp = spawn("../node_modules/.bin/ts-node", [testAppFilePath])

    let lr = new LineByLineReader(testApp.stdout)

    lr.on("line", (data: string) => {
      const stdoutData = JSON.parse(data)
      expect(stdoutData.msg).toBe("Hello from .info without tags!")
      // expect(stdoutData.foo).toBe("bar")
      testApp.kill("SIGINT")
      done()
    })
  })
})
