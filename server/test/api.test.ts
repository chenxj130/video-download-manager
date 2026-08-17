/**
 * API 自动化测试：覆盖解析、任务生命周期、控制、错误处理、恢复等。
 * 运行：cd server && npm run test:api
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? '/Users/zhaoshuixian/Desktop/视频下载/downloads';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  id: string,
  pred: (t: any) => boolean,
  timeoutMs = 30000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await req('GET', `/api/tasks/${id}`);
    const t = data?.task;
    if (t && pred(t)) return t;
    await sleep(150);
  }
  const { data } = await req('GET', `/api/tasks/${id}`);
  return data?.task;
}

async function main() {
  console.log(`\n== 在线视频下载管理器 API 测试 @ ${BASE} ==\n`);

  // 清理历史任务，保证可重复运行
  const existing = await req('GET', '/api/tasks');
  for (const t of existing.data?.tasks ?? []) {
    await req('DELETE', `/api/tasks/${t.id}?deleteFile=true`);
  }
  console.log(`[初始化] 已清理 ${existing.data?.tasks?.length ?? 0} 个遗留任务\n`);

  // 1. 解析：YouTube
  console.log('[解析]');
  const p1 = await req('POST', '/api/parse', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  check('YouTube 解析成功', p1.status === 200 && p1.data?.metadata?.platform === 'youtube');
  check('包含可用分辨率', (p1.data?.metadata?.availableResolutions?.length ?? 0) > 0);
  check('包含可用格式', (p1.data?.metadata?.availableFormats?.length ?? 0) > 0);

  // 2. 解析：不支持平台
  const p2 = await req('POST', '/api/parse', { url: 'https://example.com/foo' });
  check('不支持平台返回 400/UNSUPPORTED_PLATFORM', p2.status === 400 && p2.data?.error?.code === 'UNSUPPORTED_PLATFORM');

  // 3. 解析：无效 URL
  const p3 = await req('POST', '/api/parse', { url: 'not a url' });
  check('无效 URL 返回 400/INVALID_URL', p3.status === 400 && p3.data?.error?.code === 'INVALID_URL');

  // 4. 解析：Bilibili / TikTok / X / Instagram / Vimeo
  for (const u of [
    'https://www.bilibili.com/video/BV1xx411c7mD',
    'https://www.tiktok.com/@user/video/123',
    'https://x.com/user/status/123',
    'https://www.instagram.com/p/ABC/',
    'https://vimeo.com/123456',
  ]) {
    const r = await req('POST', '/api/parse', { url: u });
    check(`平台识别 ${u.split('/')[2]}`, r.status === 200 && !!r.data?.metadata?.platformName);
  }

  // 5. 创建任务 + 完成 + 文件落盘
  console.log('\n[任务生命周期]');
  const c1 = await req('POST', '/api/tasks', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    resolution: '1080p',
    format: 'mp4',
  });
  check('创建任务 201', c1.status === 201 && !!c1.data?.task?.id);
  const t1 = c1.data.task;
  const done1 = await waitFor(t1.id, (t) => t.status === 'completed', 30000);
  check('任务完成', done1?.status === 'completed', done1?.status);
  check('进度 100%', Math.round(done1?.progress ?? 0) === 100);
  const fs = await import('node:fs');
  const fpath = `${done1.saveDir}/${done1.fileName}`;
  check('文件已写入磁盘', fs.existsSync(fpath), fpath);
  check('文件大小一致', fs.statSync(fpath).size === done1.fileSizeBytes);

  // 6. 重复任务
  const dup = await req('POST', '/api/tasks', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    resolution: '1080p',
    format: 'mp4',
  });
  check('重复任务拒绝 409/DUPLICATE_TASK', dup.status === 409 && dup.data?.error?.code === 'DUPLICATE_TASK');

  // 7. 错误注入：网络中断
  console.log('\n[错误处理]');
  const f1 = await req('POST', '/api/tasks', {
    url: 'https://www.youtube.com/watch?v=abc?__err=network',
    resolution: '720p',
    format: 'mp4',
  });
  const ft1 = await waitFor(f1.data.task.id, (t) => t.status === 'failed', 20000);
  check('故障任务失败', ft1?.status === 'failed', ft1?.status);
  check('失败原因明确(网络连接中断)', ft1?.errorMessage === '网络连接中断', ft1?.errorMessage);

  // 8. 重试 -> 再次失败（故障仍在）
  const rt = await req('POST', `/api/tasks/${ft1.id}/retry`);
  check('重试接口 200', rt.status === 200);
  const rt2 = await waitFor(ft1.id, (t) => t.status === 'failed' || t.status === 'completed', 20000);
  check('重试后再次失败(故障保持)', rt2?.status === 'failed');

  // 9. 暂停 / 继续 / 取消（限速以保证可控）
  console.log('\n[任务控制]');
  await req('PUT', '/api/settings', { maxSpeedBytesPerSec: 1024 * 1024 }); // 1MB/s
  const c2 = await req('POST', '/api/tasks', {
    url: 'https://www.youtube.com/watch?v=pqause',
    resolution: '2160p',
    format: 'mp4',
  });
  const id2 = c2.data.task.id;
  const downloading = await waitFor(id2, (t) => t.status === 'downloading', 10000);
  check('任务进入下载中', downloading?.status === 'downloading', downloading?.status);
  await sleep(900); // 等待至少落盘一部分，验证暂停保留进度
  const pa = await req('POST', `/api/tasks/${id2}/pause`);
  const paused = await waitFor(id2, (t) => t.status === 'paused', 8000);
  check('暂停成功', pa.status === 200 && paused?.status === 'paused');
  check('暂停时保留进度', (paused?.downloadedBytes ?? 0) > 0 && (paused?.downloadedBytes ?? 0) < (paused?.fileSizeBytes ?? 1));
  const re = await req('POST', `/api/tasks/${id2}/resume`);
  check('继续接口 200', re.status === 200);
  const resuming = await waitFor(id2, (t) => t.status === 'downloading' || t.status === 'completed', 8000);
  check('继续后恢复下载', resuming?.status === 'downloading' || resuming?.status === 'completed', resuming?.status);
  const ca = await req('POST', `/api/tasks/${id2}/cancel`);
  const cancelled = await waitFor(id2, (t) => t.status === 'cancelled', 8000);
  check('取消成功', ca.status === 200 && cancelled?.status === 'cancelled');
  await req('PUT', '/api/settings', { maxSpeedBytesPerSec: 0 }); // 恢复不限速

  // 10. 历史 / 看板 / 设置 / 系统
  console.log('\n[历史/看板/系统]');
  const hist = await req('GET', '/api/history');
  check('历史记录非空', (hist.data?.history?.length ?? 0) > 0);
  const dash = await req('GET', '/api/dashboard');
  check('看板含累计任务数', (dash.data?.stats?.totalTasks ?? 0) > 0);
  check('看板成功率字段存在', typeof dash.data?.stats?.successRate === 'number');
  const sys = await req('GET', '/api/system');
  check('系统信息正常', sys.data?.system?.databaseStatus === 'ok' && sys.data?.system?.engine === 'simulate');
  const set1 = await req('PUT', '/api/settings', { maxConcurrent: 5 });
  check('设置更新生效', set1.data?.settings?.maxConcurrent === 5);
  await req('PUT', '/api/settings', { maxConcurrent: 3 });

  // 清理测试任务
  console.log('\n[清理]');
  const all = await req('GET', '/api/tasks');
  for (const t of all.data.tasks) {
    await req('DELETE', `/api/tasks/${t.id}?deleteFile=true`);
  }
  console.log(`  已清理 ${all.data.tasks.length} 个任务`);

  console.log(`\n== 结果：通过 ${pass} / 失败 ${fail} ==`);
  if (fail > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('测试运行异常', e);
  process.exit(1);
});
