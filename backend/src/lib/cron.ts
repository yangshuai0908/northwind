import { CronJob } from "cron";
import http from "node:http";
import https from "node:https";

// 每14分钟向运行状况端点发送一个GET请求
const job = new CronJob("*/14 * * * *", function () {
  const base = process.env.FRONTEND_URL;
  if (!base) return;
  const url = new URL("/health", base).href;
  const client = url.startsWith("https:") ? https : http;

  client
    .get(url, (res) => {
      if (res.statusCode === 200) console.log("GET请求发送成功");
      else console.log("GET请求失败", res.statusCode);
    })
    .on("error", (e) => console.error("发送请求时出错", e));
});

export default job;