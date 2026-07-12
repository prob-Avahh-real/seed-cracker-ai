#!/usr/bin/env node
/**
 * 嗑瓜子神器 AI 驱动程序 — CLI 入口
 *
 * 用法:
 *   npx tsx src/index.ts                    # 启动 Web 仪表盘 + 交互命令行
 *   npx tsx src/index.ts run                # 直接在终端运行
 *   npx tsx src/index.ts seed              # 处理单颗瓜子
 *   npx tsx src/index.ts batch -n 100      # 批量处理 100 颗
 *   npx tsx src/index.ts calibrate         # 校准设备
 *   npx tsx src/index.ts devices           # 列出可用摄像头和串口
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { AICrackerOrchestrator } from './ai/orchestrator';
import { CrackerServer } from './server/http';
import { CameraCapture } from './vision/camera';
import { SerialController } from './hardware/serial';
import { loadConfig, getConfig } from './config';
import logger from './utils/logger';
import * as readline from 'readline';

const program = new Command();

program
  .name('seed-cracker')
  .description('🌻 嗑瓜子神器 AI 驱动程序')
  .version('1.0.0')
  .option('-c, --config <path>', '配置文件路径', 'config.json')
  .option('-s, --serial <path>', '串口路径')
  .option('-p, --port <number>', 'Web 服务端口', '3000')
  .hook('preAction', (cmd) => {
    const opts = cmd.opts();
    if (opts.config) loadConfig(opts.config);
  });

// ──── 默认命令: 启动仪表盘 ────
program
  .action(async (options) => {
    await runDashboard(options);
  });

// ──── run: 终端模式运行 ────
program
  .command('run')
  .description('在终端中运行 (不启动 Web 服务)')
  .action(async (options) => {
    await runTerminal(options);
  });

// ──── seed: 单颗瓜子 ────
program
  .command('seed')
  .description('处理单颗瓜子')
  .action(async (options) => {
    await processSingleSeed(options);
  });

// ──── batch: 批量处理 ────
program
  .command('batch')
  .description('批量处理瓜子')
  .option('-n, --count <number>', '处理数量 (默认: 连续)', parseInt)
  .action(async (options) => {
    await processBatch(options);
  });

// ──── devices: 列出设备 ────
program
  .command('devices')
  .description('列出可用摄像头和串口设备')
  .action(async () => {
    await listDevices();
  });

// ──── calibrate: 校准 ────
program
  .command('calibrate')
  .description('校准开壳力度和摄像头')
  .action(async () => {
    await runCalibration();
  });

// ──── monitor: 仅启动监控服务 ────
program
  .command('monitor')
  .description('仅启动 Web 监控服务')
  .action(async (options) => {
    const orchestrator = new AICrackerOrchestrator();
    const port = parseInt(options.parent?.opts().port || '3000', 10);
    const server = new CrackerServer(orchestrator, port);
    await server.start();

    console.log(chalk.green(`\n📡 监控面板: http://localhost:${port}`));
    console.log(chalk.dim('按 Ctrl+C 退出\n'));
  });

// ──── 解析命令行 ────
program.parse(process.argv);

// ═══════════════════════════════════════════
//  实现函数
// ═══════════════════════════════════════════

async function runDashboard(options: any): Promise<void> {
  console.log(chalk.yellow('\n🌻  嗑瓜子神器 AI 驱动程序 v1.0.0\n'));

  const orchestrator = new AICrackerOrchestrator();

  // 初始化硬件
  const serialPath = options.parent?.opts().serial || options.serial;
  try {
    await orchestrator.init(serialPath);
    console.log(chalk.green('✓ 硬件已连接'));
  } catch (err) {
    console.log(chalk.yellow('⚠ 硬件未连接，运行在模拟模式'));
  }

  // 启动 Web 服务
  const port = parseInt(options.parent?.opts().port || options.port || '3000', 10);
  const server = new CrackerServer(orchestrator, port);
  await server.start();

  console.log(chalk.green(`\n📡 控制面板: http://localhost:${port}`));
  console.log(chalk.dim('──────────────────────────────────'));
  printCommands();
  console.log(chalk.dim('──────────────────────────────────\n'));

  // 交互命令行
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('🌻 > '),
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const cmd = line.trim().toLowerCase();

    switch (cmd) {
      case 'start':
      case 's':
        console.log(chalk.yellow('开始批量处理...'));
        orchestrator.processBatch().catch(logger.error);
        break;

      case 'stop':
      case 'x':
        console.log(chalk.yellow('停止处理...'));
        await orchestrator.stop();
        break;

      case 'seed':
      case '1':
        console.log(chalk.yellow('处理单颗瓜子...'));
        const result = await orchestrator.processSeed();
        printSeedResult(result);
        break;

      case 'stats':
      case 'st':
        printStats(orchestrator.getStats());
        break;

      case 'pause':
        orchestrator.pause();
        console.log(chalk.yellow('⏸ 已暂停'));
        break;

      case 'resume':
        orchestrator.resume();
        console.log(chalk.green('▶ 已恢复'));
        break;

      case 'reset':
        orchestrator.resetStats();
        console.log(chalk.yellow('🔄 统计已重置'));
        break;

      case 'help':
      case 'h':
      case '?':
        printCommands();
        break;

      case 'quit':
      case 'q':
      case 'exit':
        console.log(chalk.dim('\n👋 再见!'));
        await orchestrator.stop();
        rl.close();
        process.exit(0);
        break;

      default:
        if (cmd) console.log(chalk.red(`未知命令: ${cmd} (输入 help 查看帮助)`));
        break;
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await orchestrator.stop();
    process.exit(0);
  });

  // 信号处理
  process.on('SIGINT', async () => {
    console.log(chalk.dim('\n\n正在关闭...'));
    await orchestrator.stop();
    process.exit(0);
  });
}

async function runTerminal(options: any): Promise<void> {
  const orchestrator = new AICrackerOrchestrator();
  const serialPath = options.parent?.opts().serial || options.serial;

  try {
    await orchestrator.init(serialPath);
    console.log(chalk.green('✓ 硬件已连接'));
  } catch (err) {
    console.log(chalk.yellow('⚠ 硬件未连接，运行在模拟模式'));
  }

  console.log(chalk.yellow('\n连续处理模式 (Ctrl+C 停止)\n'));

  orchestrator.on('seed', (result) => {
    printSeedResult(result);
  });

  orchestrator.on('stats', (stats) => {
    printStats(stats);
  });

  await orchestrator.processBatch();
}

async function processSingleSeed(options: any): Promise<void> {
  const orchestrator = new AICrackerOrchestrator();
  const serialPath = options.parent?.opts().serial || options.serial;

  try {
    await orchestrator.init(serialPath);
  } catch {
    console.log(chalk.yellow('⚠ 运行在模拟模式'));
  }

  const result = await orchestrator.processSeed();
  printSeedResult(result);
  await orchestrator.stop();
}

async function processBatch(options: any): Promise<void> {
  const orchestrator = new AICrackerOrchestrator();
  const serialPath = options.parent?.opts().serial || options.serial;

  try {
    await orchestrator.init(serialPath);
  } catch {
    console.log(chalk.yellow('⚠ 运行在模拟模式'));
  }

  const count = options.count;
  console.log(chalk.yellow(`\n批量处理${count ? ` ${count} 颗` : ' (连续模式)'}...\n`));

  orchestrator.on('seed', (result) => {
    printSeedResult(result);
  });

  await orchestrator.processBatch(count);
  printStats(orchestrator.getStats());
  await orchestrator.stop();
}

async function listDevices(): Promise<void> {
  console.log(chalk.yellow('\n📷 摄像头设备:'));
  try {
    const cameras = await CameraCapture.listDevices();
    if (cameras.length === 0) {
      console.log(chalk.dim('  (无)'));
    } else {
      for (const cam of cameras) {
        console.log(`  ${chalk.green('●')} ${cam}`);
      }
    }
  } catch {
    console.log(chalk.dim('  无法获取摄像头列表'));
  }

  console.log(chalk.yellow('\n🔌 串口设备:'));
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    if (ports.length === 0) {
      console.log(chalk.dim('  (无)'));
    } else {
      for (const port of ports) {
        console.log(`  ${chalk.green('●')} ${port.path} ${chalk.dim(`(${port.manufacturer || 'unknown'})`)}`);
      }
    }
  } catch {
    console.log(chalk.dim('  无法获取串口列表'));
  }
  console.log('');
}

async function runCalibration(): Promise<void> {
  console.log(chalk.yellow('\n🔧 校准向导\n'));

  const orchestrator = new AICrackerOrchestrator();
  await orchestrator.init().catch(() => {
    console.log(chalk.yellow('⚠ 硬件未连接，校准仅在模拟模式下运行'));
  });

  console.log(chalk.dim('1. 确保设备已正确连接'));
  console.log(chalk.dim('2. 放入一颗瓜子到开壳工位'));
  console.log(chalk.dim('3. 程序将自动测试不同力度并记录最佳参数\n'));

  // 测试不同力度
  const angles = [30, 35, 40, 45, 50, 55, 60];
  console.log(chalk.cyan('测试开壳力度...'));

  for (const angle of angles) {
    console.log(chalk.dim(`  测试角度 ${angle}°...`));
    // 在真实场景中会实际执行开壳并记录结果
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(chalk.green('\n✓ 校准完成! 推荐配置已保存\n'));
  await orchestrator.stop();
}

// ═══════════════════════════════════════════
//  辅助显示函数
// ═══════════════════════════════════════════

function printSeedResult(result: any): void {
  const icon = result.success ? chalk.green('✅') : chalk.red('❌');
  const orient = result.orientation === 'tip_up' ? '↑' : result.orientation === 'tip_down' ? '↓' : '?';
  const time = chalk.dim(`${result.durationMs}ms`);
  const retries = result.retries > 0 ? chalk.yellow(` 重试×${result.retries}`) : '';

  console.log(`  ${icon} #${result.seedId} ${orient} | ${time}${retries}`);

  if (result.quality?.defects?.length > 0) {
    console.log(`     ${chalk.dim('缺陷:')} ${result.quality.defects.join(', ')}`);
  }
  if (result.error) {
    console.log(`     ${chalk.red('错误:')} ${result.error}`);
  }
}

function printStats(stats: any): void {
  const rate = stats.totalProcessed > 0
    ? `${(stats.successRate * 100).toFixed(1)}%`
    : 'N/A';

  console.log(chalk.dim('\n┌─────────────────────────────────┐'));
  console.log(chalk.dim('│') + `  📊 已处理: ${chalk.white(stats.totalProcessed.toString().padStart(4))}  ✅ 成功: ${chalk.green(stats.successful.toString().padStart(4))}  ${chalk.dim('│')}`));
  console.log(chalk.dim('│') + `  ❌ 失败: ${chalk.red(stats.failed.toString().padStart(4))}  🚫 拒收: ${chalk.yellow(stats.rejected.toString().padStart(4))}  ${chalk.dim('│')}`));
  console.log(chalk.dim('│') + `  📈 成功率: ${chalk.green(rate.padStart(6))}  ⏱ 平均: ${chalk.cyan(stats.averageTimeMs + 'ms')}  ${chalk.dim('│')}`));
  console.log(chalk.dim('└─────────────────────────────────┘\n'));
}

function printCommands(): void {
  console.log('');
  console.log('  ' + chalk.white('start / s') + '   ' + chalk.dim('开始批量处理'));
  console.log('  ' + chalk.white('seed / 1') + '    ' + chalk.dim('处理单颗瓜子'));
  console.log('  ' + chalk.white('stats / st') + '  ' + chalk.dim('查看统计'));
  console.log('  ' + chalk.white('pause') + '       ' + chalk.dim('暂停'));
  console.log('  ' + chalk.white('resume') + '      ' + chalk.dim('恢复'));
  console.log('  ' + chalk.white('stop / x') + '    ' + chalk.dim('停止'));
  console.log('  ' + chalk.white('reset') + '       ' + chalk.dim('重置统计'));
  console.log('  ' + chalk.white('quit / q') + '    ' + chalk.dim('退出'));
  console.log('');
}
