import type { SyncJob } from "../types";

export function createDemoJobs(now = new Date()): SyncJob[] {
  const date = now.toISOString().slice(0, 10);
  const updatedAt = now.toISOString();
  const suffix = now.getTime().toString(36);
  return [
    {
      jobId: `demo_daily_${suffix}`,
      actraId: `daily_${date}`,
      type: "daily_summary",
      revision: 1,
      updatedAt,
      content: {
        title: `${date} 每日总结`,
        date,
        project: "ACTRA",
        tags: ["daily"],
        summary: "今天完成了 ACTRA Obsidian 插件的本地联调，并确认同步只在 Obsidian 打开后发生。",
        tasks: [
          { id: `task_review_${suffix}`, text: "Review 插件交互与安全边界", dueDate: date },
          { id: `task_test_${suffix}`, text: "完成本地 Obsidian 验收" }
        ]
      }
    },
    {
      jobId: `demo_recording_${suffix}`,
      actraId: `recording_${suffix}`,
      type: "recording",
      revision: 1,
      updatedAt,
      content: {
        title: "ACTRA 产品会议",
        date,
        project: "ACTRA",
        tags: ["meeting"],
        summary: "会议确认了配对、目录授权、启动拉取和冲突保护方案。",
        transcript: "这是本地演示转写。生产环境中的内容由 ACTRA 待同步队列提供。",
        audioUrl: "https://app.actra.example/recordings/demo"
      }
    }
  ];
}
