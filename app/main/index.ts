import { refreshModelsWithBaseline, readModelsCache } from '../../src/core/models.ts';
import { modelsRefresher, modelsRefreshHandler, modelsKeepHandler, modelsAddHandler, modelsScheduler } from './models.ts';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, nativeTheme, net, protocol, screen, session, shell } from 'electron';
import { connect, connectArgument, connectStatus, disconnect } from '../../src/core/connect.ts';
import { INTRO_TEXT } from '../../src/core/intro.ts';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktopPath, paths } from '../../src/core/paths.ts';
import { buildView } from '../../src/core/view.ts';
import { channels } from '../shared/ipc.ts';
import { readJob } from '../../src/core/job.ts';
import { decide, requestRedo } from '../../src/core/decide.ts';
import { stop } from '../../src/core/commands.ts';
import { addComment, cleanComment } from '../../src/core/comments.ts';
import { createChat, renameChat, sayInChat } from '../../src/core/chat.ts';
import { stopChat } from '../../src/core/chat-engine.ts';
import { sayInTeam, stopTeam } from '../../src/core/team.ts';
import { readSettings, writeSettings, setNetworkAllowed, keepModels, addModel, loadConfiguredRoster } from '../../src/core/settings.ts';
import { queryQuota, readQuotaCache } from '../../src/core/quota.ts';
import type { View } from '../../src/core/view-types.ts';
import type { Destination, CliStatus } from '../shared/ipc.ts';
import { applyAppearance, syncBackground, titleBarOverlay, windowBackground } from './appearance.ts';
import { jobActions, quotaRefreshHandler, quotaRefresher, settingsActions, teamActions, chatActions, planActions, planSpecActions } from './actions.ts';
import { noticeTitle, notificationTracker } from './notifications.ts';
import type { Notice } from './notifications.ts';
import { createTray } from './tray.ts';
import { readIcon } from './icons.ts';
import { installIcons } from '../../src/core/icons.ts';
import { httpsLink, securePreferences, secureSession, trustedSender } from './security.ts';
import { loadBounds, saveBounds } from './window-state.ts';
import { watchRegistry } from './watch.ts';
import { startDesktop } from './startup.ts';
import { slimScheduler } from './slim.ts';
import { slimOld } from '../../src/core/slim.ts';
import { loginDeepseek } from '../../src/core/workers.ts';
import { queryDeepseekModels } from '../../src/core/deepseek-models.ts';
// Electron 自带的“原始文件函数”：不把路径里的 .asar 当虚拟目录（更新包里有 app.asar，见 update-install.ts）。
import originalFs from 'original-fs';
import { desktopUpdater } from './update-runtime.ts';
import { cliLauncherStatus, installCliLauncher, refreshCliLauncher } from './cli-launcher.ts';
import { updateActions } from './updater.ts';
import type { Updater } from './updater.ts';
import { addProject } from '../../src/core/project.ts';
import { checkProject } from '../../src/core/project-check.ts';
import { git } from '../../src/core/worktree.ts';
import { projectActions, projectSelections } from './project-bridge.ts';
import { planDispatch } from '../../src/core/plan-dispatch.ts';
import { resolveTaskSpec } from '../../src/core/task-plan.ts';

// `net.fetch` may collapse proxy/TLS failures into a bare `TypeError: fetch failed`.
// ClientRequest still honours the system proxy and exposes the actual network error.
const electronRequest: typeof fetch = ((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
  const rawHeaders = init?.headers && !Array.isArray(init.headers) && !(init.headers instanceof Headers)
    ? init.headers as Record<string, string>
    : Object.fromEntries(new Headers(init?.headers).entries());
  const request = net.request({ url: String(input), method: init?.method ?? 'GET', headers: rawHeaders, redirect: 'error', credentials: 'omit' });
  let settled = false;
  const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
  const abort = () => { request.abort(); fail(new DOMException('The operation was aborted', 'AbortError')); };
  if (init?.signal?.aborted) return abort();
  init?.signal?.addEventListener('abort', abort, { once: true });
  request.once('error', error => fail(new Error(`网络连接失败：${error.message}`)));
  request.once('response', response => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) { request.abort(); fail(new Error('中转站返回的模型列表过大。')); return; }
      chunks.push(chunk);
    });
    response.once('error', error => fail(new Error(`读取中转站响应失败：${error.message}`)));
    response.once('end', () => {
      if (settled) return;
      settled = true;
      init?.signal?.removeEventListener('abort', abort);
      const headers = new Headers();
      for (const [name, values] of Object.entries(response.headers)) for (const value of values) headers.append(name, value);
      resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
    });
  });
  request.end();
})) as typeof fetch;

declare const __XA_DEVELOPMENT__: boolean;
declare const __XA_UPDATE_FEED__: string;
declare const __XA_UPDATE_PUBLIC_KEY__: string;
declare const __XA_UPDATE_HOSTS__: string[];
protocol.registerSchemesAsPrivileged([{ scheme: 'xa-icon', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('派活工作台');
// Windows：系统通知要认得出是哪个应用才弹得出来，用和安装包一致的应用标识。
if (process.platform === 'win32') app.setAppUserModelId('app.xagents.desk');
process.env.PATH = desktopPath(process.env.PATH);
// 安装脚本请旧进程退出时，也走 before-quit 保存窗口位置、停止定时清理。
process.once('SIGTERM', () => app.quit());
// 冒烟测试的 Electron 用户数据也与真实应用隔离；生产不设置这个变量。
if (process.env.XAGENTS_USER_DATA) app.setPath('userData', process.env.XAGENTS_USER_DATA);
let window: BrowserWindow | null = null;
let opening: Promise<void> | undefined;
let closeWatch: (() => void) | undefined;
let modelSchedule: ReturnType<typeof modelsScheduler> | undefined;
let quotaTimer: ReturnType<typeof setInterval> | undefined;
const QUOTA_EVERY_MS = 15 * 60_000;
let slimmer: ReturnType<typeof slimScheduler> | undefined;
let updater: Updater | undefined;
let saving = Promise.resolve();
let exiting = false;
let tray: ReturnType<typeof createTray> | undefined;
let pendingOpen: Destination | undefined;
let track: Awaited<ReturnType<typeof notificationTracker>> | undefined;
let notificationWork = Promise.resolve();
const liveNotifications = new Set<Notification>();
// 项目选择令牌只在这个进程的内存里；窗口一关就清掉。见 app/main/project-bridge.ts。
const projectTokens = projectSelections();
const e2eNotices: Notice[] | undefined = process.env.XAGENTS_E2E === '1' ? [] : undefined;
// 冒烟测试在后台跑：窗口照常创建、绘制和截图，但不显示到屏幕上，程序坞里也不出图标，免得打扰正在用电脑的人。
const e2eHidden = process.env.XAGENTS_E2E === '1';
if (e2eHidden) app.dock?.hide();
function reveal(target?: Destination) {
  if (target) pendingOpen = target;
  void openWindow().then(() => {
    if (pendingOpen && window && !window.webContents.isLoadingMainFrame()) {
      window.webContents.send(channels.open, pendingOpen); pendingOpen = undefined;
    }
  }).catch(console.error);
}
const readDesktopView = buildView;
function publish(view: View) {
  tray?.update(view);
  if (window && !window.isDestroyed()) window.webContents.send(channels.view, view);
  if (track) notificationWork = track(view).catch(console.error);
}
function sendNotice(notice: Notice) {
  if (e2eNotices) { e2eNotices.push(notice); return; }
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: noticeTitle(notice), body: notice.body });
  liveNotifications.add(notification);
  notification.on('click', () => reveal(notice.target));
  notification.on('close', () => liveNotifications.delete(notification));
  notification.on('failed', () => liveNotifications.delete(notification));
  notification.show();
}
// 构建时折叠为 false，运行构建产物时也不能靠环境变量切回开发服务器。
const devUrl = __XA_DEVELOPMENT__ && !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
if (devUrl) {
  const url = new URL(devUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('开发页面必须来自本机 Vite');
}
const pageFile = join(import.meta.dirname, '../renderer/index.html');
const pageUrl = devUrl ? new URL(devUrl).href : pathToFileURL(pageFile).href;

// 红黄绿按钮：随顶栏（48px，见 docs/ui-spec.md 第 11 节和 tokens.css 的 --topbar-h）垂直居中；y 是按钮组上沿，按钮约 14px 高。
const TRAFFIC_LIGHTS = { x: 18, y: 16 };

async function openWindow() {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    if (!e2eHidden) { window.show(); window.focus(); }
    return;
  }
  if (opening) return opening;
  opening = (async () => {
    const bounds = await loadBounds(app.getPath('userData'));
    if (bounds.x !== undefined && bounds.y !== undefined && !screen.getAllDisplays().some(display => {
      const area = display.workArea;
      return bounds.x! < area.x + area.width && bounds.x! + bounds.width > area.x && bounds.y! < area.y + area.height && bounds.y! + bounds.height > area.y;
    })) { delete bounds.x; delete bounds.y; }
    // 顶栏就是标题栏。macOS：左上角留红黄绿按钮；Windows：右上角三个窗口按钮由系统画在顶栏上，不显示菜单栏。
    const chrome = process.platform === 'win32'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors), autoHideMenuBar: true }
      : { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: TRAFFIC_LIGHTS };
    const current = new BrowserWindow({ ...bounds, minWidth: 900, minHeight: 600, title: '派活工作台',
      ...chrome, show: false,
      backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
      webPreferences: { ...securePreferences, preload: join(import.meta.dirname, '../preload/index.cjs'), partition: 'xa-desktop' } });
    window = current;
    const contentsId = current.webContents.id;
    // 留给页面处理，防止默认菜单的 Cmd+R（Windows 上是 Ctrl+R）先把整个窗口重载。
    current.webContents.on('before-input-event', (_event, input) => {
      const modifier = process.platform === 'win32' ? input.control : input.meta;
      current.webContents.setIgnoreMenuShortcuts(modifier && ['1', '2', '3', '4', 'r'].includes(input.key.toLowerCase()));
    });
    current.webContents.on('will-navigate', event => event.preventDefault());
    current.webContents.on('will-redirect', event => event.preventDefault());
    current.webContents.on('will-attach-webview', event => event.preventDefault());
    current.webContents.setWindowOpenHandler(({ url }) => {
      const external = httpsLink(url);
      if (external) void shell.openExternal(external).catch(console.error);
      return { action: 'deny' };
    });
    if (!e2eHidden) current.once('ready-to-show', () => current.show());
    current.on('close', event => {
      projectTokens.forget(contentsId);
      if (exiting) return;
      event.preventDefault(); current.hide();
      const normal = current.getNormalBounds();
      saving = saving.then(() => saveBounds(app.getPath('userData'), normal)).catch(console.error);
    });
    current.on('closed', () => {
      projectTokens.forget(contentsId);
      if (window === current) window = null;
    });
    if (devUrl) await current.loadURL(pageUrl); else await current.loadFile(pageFile);
  })().finally(() => { opening = undefined; });
  return opening;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { void app.whenReady().then(openWindow).catch(console.error); });
  app.on('activate', () => { void openWindow().catch(console.error); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    closeWatch?.();
    modelSchedule?.stop();
    if (quotaTimer) clearInterval(quotaTimer);
    slimmer?.stop();
    updater?.stop();
    tray?.destroy(); tray = undefined;
    if (!exiting) {
      event.preventDefault(); exiting = true;
      if (window && !window.isDestroyed()) {
        const bounds = window.getNormalBounds();
        saving = saving.then(() => saveBounds(app.getPath('userData'), bounds)).catch(console.error);
      }
      void Promise.all([saving, notificationWork]).finally(() => app.quit());
    }
  });
  void app.whenReady().then(async () => {
    // 命令行启动脚本：没装的自动装上，应用换了位置的跟着改；出错只记日志，不影响启动。
    if (app.isPackaged) await refreshCliLauncher().catch(console.error);
    await loadConfiguredRoster();
    // 每次启动补齐本机后来安装的厂家图标；已有文件不会重复转换。
    await installIcons().catch(console.error);
    applyAppearance(nativeTheme, (await readSettings()).appearance);
    nativeTheme.on('updated', () => syncBackground(nativeTheme, window));
    // 自动清理旧日志：冒烟测试（XAGENTS_E2E=1）里不跑。清理后账目变了，重新发一份看板数据；出错只写日志。
    if (!e2eHidden) {
      slimmer = slimScheduler({ run: async () => { if ((await slimOld()).jobs.length) publish(await readDesktopView()); }, onError: console.error });
      slimmer.start();
    }
    const isolated = session.fromPartition('xa-desktop');
    secureSession(isolated, devUrl);
    isolated.protocol.handle('xa-icon', async request => {
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      try { return new Response(await readIcon(request.url, paths().home), { headers: { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff' } }); }
      catch { return new Response(null, { status: 404 }); }
    });
    const actions = jobActions({ readJob, decide, requestRedo, stop, comment: addComment, checkComment: cleanComment });
    const chatBridge = chatActions({ create: createChat, say: sayInChat, stop: stopChat, rename: renameChat });
    const teamBridge = teamActions({ say: sayInTeam, stop: stopTeam, checkText: cleanComment });
    const settings = settingsActions({ readSettings, writeSettings, setNetworkAllowed,
      getLogin: () => app.getLoginItemSettings().openAtLogin,
      setLogin: value => app.setLoginItemSettings({ openAtLogin: value }),
      setAppearance: value => applyAppearance(nativeTheme, value, window),
      storageChanged: () => { void slimmer?.now(); },
    }, async () => publish(await readDesktopView()));
    const models = modelsRefresher({ query: () => refreshModelsWithBaseline(), readCache: readModelsCache }, async () => publish(await readDesktopView()));
    const quota = quotaRefresher({ query: () => queryQuota() }, async () => publish(await readDesktopView()));
    const guard = (event: Electron.IpcMainInvokeEvent) => {
      if (!trustedSender(event, window, pageUrl)) throw new Error('不允许的请求来源。');
    };
    // 项目登记：原生目录选择只交回展示数据和一次性令牌；仓库路径由后台记住，窗口交不进任何路径。
    // 系统选择器用的是 Electron 的 dialog（macOS 和 Windows 都是系统原生的），取消不算错误。
    let choosing = false;
    const projects = projectActions({
      chooseFolder: async () => {
        if (choosing) throw new Error('正在选择文件夹，请稍等。');
        choosing = true;
        try {
          const parent = window && !window.isDestroyed() ? window : null;
          const options: Electron.OpenDialogOptions = { properties: ['openDirectory'], title: '选择 Git 仓库' };
          const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
          return result.canceled ? null : result.filePaths[0] ?? null;
        } finally { choosing = false; }
      },
      realpath, git, addProject,
      checkProject: name => checkProject(name, { quick: true }),
      updated: async () => { publish(await readDesktopView()); },
      onError: console.error,
    }, { selections: projectTokens });
    updater = await desktopUpdater({
      development: __XA_DEVELOPMENT__, packaged: app.isPackaged,
      feed: __XA_UPDATE_FEED__, publicKey: __XA_UPDATE_PUBLIC_KEY__, hosts: __XA_UPDATE_HOSTS__,
      version: app.getVersion(), platform: process.platform, arch: process.arch,
      executable: process.execPath, userData: app.getPath('userData'), quit: () => app.quit(),
      files: originalFs.promises,
      publish: state => { if (window && !window.isDestroyed()) window.webContents.send(channels.onUpdate, state); },
    });
    const updates = updateActions(updater);
    // 命令行启动脚本：开发版不提供；参数只认一个开关，路径都由后台自己定，窗口传不进来。
    const cliStatus = async (): Promise<CliStatus> => app.isPackaged ? cliLauncherStatus() : 'unavailable';
    ipcMain.handle(channels.cliStatus, (event, ...args: unknown[]) => { guard(event); if (args.length) throw new Error('读取命令行状态不需要参数。'); return cliStatus(); });
    // 位置：只有两处固定的位置（程序所在的文件夹、登记处），窗口传不进路径。
    const places = () => ({ app: dirname(process.execPath), data: paths().home });
    ipcMain.handle(channels.places, (event, ...args: unknown[]) => { guard(event); if (args.length) throw new Error('读取位置不需要参数。'); return places(); });
    ipcMain.handle(channels.openPlace, async (event, ...args: unknown[]) => {
      guard(event);
      if (args.length !== 1 || (args[0] !== 'app' && args[0] !== 'data')) throw new Error('只能打开程序或数据所在的文件夹。');
      const failed = await shell.openPath(places()[args[0]]);
      if (failed) throw new Error(failed);
    });
    // 隔离（只在 Windows 上）：主人在设置里点了才做。没装好就先装——提权的确认框由系统弹、主人自己点，应用不替主人提权——再自检；
    // 自检结果写进缓存，随看板数据推给窗口。同一时间只做一次。
    let fixing = false;
    ipcMain.handle(channels.isolationFix, async (event, ...args: unknown[]) => {
      guard(event);
      if (args.length) throw new Error('安装和检查隔离不需要参数。');
      if (process.platform !== 'win32') throw new Error('只有 Windows 上的隔离需要另外安装。');
      if (fixing) throw new Error('正在安装或检查，请稍等。');
      fixing = true;
      try {
        const { readSelfcheck, selfcheck } = await import('../../src/core/selfcheck.ts');
        if ((await readSelfcheck()).ok !== true) {
          const { windowsSetup } = await import('../../src/core/selfcheck-windows.ts');
          const { execute } = await import('../../src/core/verify.ts');
          const setup = await windowsSetup(execute);
          if (!setup.ok) throw new Error(setup.lines.join('；'));
        }
        await selfcheck();
      } finally { fixing = false; publish(await readDesktopView()); }
    });
    ipcMain.handle(channels.cliInstall, async (event, ...args: unknown[]) => {
      guard(event);
      if (args.length !== 1 || typeof args[0] !== 'boolean') throw new Error('安装命令行只能接收一个开关。');
      if (!app.isPackaged) throw new Error('开发版不安装命令行。');
      await installCliLauncher({ replace: args[0] });
      return cliStatus();
    });
    for (const action of ['appInfo', 'updateCheck', 'updateDownload', 'updateRestart', 'setAutoUpdateCheck'] as const) {
      ipcMain.handle(channels[action], (event, ...args: unknown[]) => { guard(event); return updates[action](args); });
    }
    ipcMain.handle(channels.getView, async (event, ...args: unknown[]) => {
      guard(event);
      if (args.length) throw new Error('读取看板不需要参数。');
      const view = await readDesktopView();
      if (pendingOpen) {
        window?.webContents.send(channels.open, pendingOpen); pendingOpen = undefined;
      }
      return view;
    });
    // 项目登记（docs/tasks/TASK-001.md）：选择不带参数；登记只认选择令牌和允许的字段，仓库路径进不来。
    ipcMain.handle(channels.projectChoose, (event, ...args: unknown[]) => { guard(event); return projects.choose(args, event.sender.id); });
    ipcMain.handle(channels.projectRegister, (event, ...args: unknown[]) => { guard(event); return projects.register(args, event.sender.id); });
    // 规划派发（docs/tasks/TASK-006.md）：核心重新读规划做权威校验后走现有派发流程；成功后发布新 View。
    const planBridge = planActions({ dispatch: input => planDispatch(input) });
    ipcMain.handle(channels.planDispatch, async (event, ...args: unknown[]) => {
      guard(event);
      const ids = await planBridge(args);
      publish(await readDesktopView());
      return ids;
    });
    // 打开 Task Spec（docs/tasks/TASK-006.md）：窗口交不进路径。核心按已登记项目和 TASK-005 的 spec 契约
    // 解析出仓库内的真实文件，只有解析成功才交给系统打开；解析失败原样把中文原因交回窗口。
    const planSpecBridge = planSpecActions({ open: async input => {
      const file = await resolveTaskSpec(input.project, input.spec);
      const failed = await shell.openPath(file);
      if (failed) throw new Error(failed);
    } });
    ipcMain.handle(channels.planSpec, async (event, ...args: unknown[]) => { guard(event); await planSpecBridge(args); });
    for (const action of ['decide', 'redo', 'stop', 'comment'] as const) ipcMain.handle(channels[action], async (event, ...args: unknown[]) => {
      guard(event); await actions(action, args);
    });
    ipcMain.handle(channels.chatCreate, async (event, ...args: unknown[]) => { guard(event); return chatBridge('create', args); });
    ipcMain.handle(channels.chatSay, async (event, ...args: unknown[]) => { guard(event); await chatBridge('say', args); });
    ipcMain.handle(channels.chatStop, async (event, ...args: unknown[]) => { guard(event); await chatBridge('stop', args); });
    ipcMain.handle(channels.chatRename, async (event, ...args: unknown[]) => { guard(event); await chatBridge('rename', args); });
    ipcMain.handle(channels.teamSay, async (event, ...args: unknown[]) => { guard(event); await teamBridge('say', args); });
    ipcMain.handle(channels.teamStop, async (event, ...args: unknown[]) => { guard(event); await teamBridge('stop', args); });
    ipcMain.handle(channels.modelsRefresh, modelsRefreshHandler(models, event => trustedSender(event, window, pageUrl)));
    ipcMain.handle(channels.modelsKeep, modelsKeepHandler({ keep: keepModels }, async () => { await loadConfiguredRoster(); publish(await readDesktopView()); }, event => trustedSender(event, window, pageUrl)));
    ipcMain.handle(channels.modelsAdd, modelsAddHandler({ add: addModel }, async () => { await loadConfiguredRoster(); publish(await readDesktopView()); }, event => trustedSender(event, window, pageUrl)));
    ipcMain.handle(channels.quotaRefresh, quotaRefreshHandler(quota, event => trustedSender(event, window, pageUrl)));
    // 复制对接提示词：只写固定的那一份，不收参数；窗口自己没有剪贴板权限（security.ts 拒绝一切权限请求）。
    ipcMain.handle(channels.copyIntro, (event, ...args: unknown[]) => { guard(event); if (args.length) throw new Error('复制对接提示词不需要参数。'); clipboard.writeText(INTRO_TEXT); });
    ipcMain.handle(channels.connectStatus, (event, ...args: unknown[]) => { guard(event); if (args.length) throw new Error('读取接入状态不需要参数。'); return connectStatus(); });
    ipcMain.handle(channels.connect, (event, ...args: unknown[]) => { guard(event); return connect(connectArgument(args)); });
    ipcMain.handle(channels.disconnect, (event, ...args: unknown[]) => { guard(event); return disconnect(connectArgument(args)); });
    ipcMain.handle(channels.settingsGet, (event, ...args: unknown[]) => { guard(event); return settings.get(args); });
    ipcMain.handle(channels.settingsSet, (event, ...args: unknown[]) => { guard(event); return settings.set(args); });
    ipcMain.handle(channels.deepseekLogin, (event, ...args: unknown[]) => {
      guard(event);
      if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('DeepSeek API 密钥参数不对。');
      return loginDeepseek(args[0]);
    });
    ipcMain.handle(channels.deepseekModels, (event, ...args: unknown[]) => {
      guard(event);
      if ((args.length !== 1 && args.length !== 2) || typeof args[0] !== 'object' || (args[1] !== undefined && typeof args[1] !== 'string')) throw new Error('获取 DeepSeek 模型的参数不对。');
      return queryDeepseekModels(args[0] as import('../../src/core/deepseek-settings.ts').DeepseekEndpoint, args[1] as string | undefined, electronRequest);
    });
    ipcMain.handle(channels.networkAllowed, (event, ...args: unknown[]) => { guard(event); return settings.allowNetwork(args); });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '派活工作台', submenu: [{ label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => reveal({ kind: 'settings' }) }, { type: 'separator' }, { label: '退出', role: 'quit' }] },
      { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
      { label: '窗口', submenu: [{ label: '最小化', role: 'minimize' }, { label: '关闭窗口', role: 'close' }] },
    ]));
    tray = createTray(reveal, () => app.quit());
    if (e2eNotices) Object.defineProperty(globalThis, '__xaE2E', { value: { notices: e2eNotices, tray: () => tray?.inspect() }, configurable: true });
    await startDesktop({
      openWindow,
      startNotifications: async () => { track = await notificationTracker(app.getPath('userData'), sendNotice); },
      startWatching: async () => { closeWatch = await watchRegistry(() => !exiting, publish, console.error, readDesktopView, undefined, true); },
      refresh: async () => { publish(await readDesktopView()); await notificationWork; },
      onError: console.error,
    });
    updater.start();
    if (!e2eHidden) {
      modelSchedule = modelsScheduler({ readCache: readModelsCache }, models, console.error);
      modelSchedule.start();
    }
    // 应用开着时每 15 分钟查一次额度；启动时数据已经超过 15 分钟也查一次（冒烟测试里不查）。
    quotaTimer = setInterval(() => { void quota.auto(console.error); }, QUOTA_EVERY_MS);
    if (!e2eNotices) {
      const cached = await readQuotaCache();
      if (!cached || Date.now() - Date.parse(cached.queriedAt) > QUOTA_EVERY_MS) void quota.auto(console.error);
    }
  }).catch(error => { console.error(error); app.quit(); });
}
