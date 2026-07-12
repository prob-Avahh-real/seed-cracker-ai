# Seed Cracker AI

嗑瓜子神器 AI 驱动程序 — 基于计算机视觉和深度学习的智能瓜子开壳控制系统

## 命令

```bash
npm install
npx tsc --noEmit     # 类型检查
npx eslint src/      # 代码规范
npx jest --coverage  # 测试
npx tsc              # 构建
```

## 架构

```
src/
├── ai/
│   ├── state-machine.ts    ← 9 状态状态机 (IDLE→FEEDING→...→EJECTING)
│   ├── orchestrator.ts     ← AICrackerOrchestrator (核心流水线)
│   ├── cracker-agent.ts    ← CrackerAgent (自主决策层)
│   └── quality.ts          ← QualityAssessor (开壳质量评估)
├── vision/
│   ├── camera.ts           ← CameraCapture (node-webcam)
│   ├── detector.ts         ← SeedDetector (Otsu + 泛洪填充 + NMS)
│   └── classifier.ts       ← OrientationClassifier (重心偏移 + TF模型)
├── hardware/
│   ├── serial.ts           ← SerialController (Arduino 串口)
│   └── servo.ts            ← ServoController (舵机抽象)
├── server/
│   └── http.ts             ← Express + WebSocket
├── config.ts               ← 全局配置 + deepMerge
└── utils/logger.ts

tests/
├── state-machine.test.ts
├── detector.test.ts
├── quality.test.ts
├── config.test.ts
└── cracker-agent.test.ts
```

## Agent 能力

- 自适应调速 (成功率 > 90% → 加速; < 50% → 减速)
- 学习最佳开壳角度
- 连续失败自动停机
- 预测性维护 (5000 次动作提醒)
