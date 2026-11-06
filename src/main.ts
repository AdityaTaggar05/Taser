import Phaser from 'phaser';
import { WatchScreen } from './betting/WatchScreen';
import './style.css';
import type { CampaignSummary, EditorView } from './editor/types';
let levels: CampaignSummary[] = [];
import { isLive, type Direction, type StepSnapshot } from './core/types';
import { BoardView } from './render/BoardView';
import {
  environments,
  buildEnvironment,
  loadEnvironmentSheet,
  type EnvironmentPack,
} from './render/environment';
import { KEY_MOVES } from './input/TurnBuffer';
import { Hud } from './ui/Hud';
import { GameAudio } from './ui/audio';
import { HomeScreen } from './ui/HomeScreen';
import { PartyLobby } from './ui/PartyLobby';
import { joinIntent } from './network/routes';
import { ArkivPanel } from './ui/ArkivPanel';
import { MoveSequence } from './ui/MoveSequence';
import { PublishedLevels } from './ui/PublishedLevels';
import { Leaderboards } from './ui/Leaderboards';
import { TitleBackdrop } from './render/TitleBackdrop';
import { CoopClient } from './network/CoopClient';
import { RemoteView } from './network/RemoteView';
import { OtherPerspectiveView } from './network/OtherPerspectiveView';
import type { SessionState } from './network/protocol';
import { AuthClient } from './auth/AuthClient';
import { SignInScreen } from './ui/SignInScreen';
import { EditorScreen } from './editor/EditorScreen';
import { LevelClient } from './editor/LevelClient';
import type { GameEngine } from './core/engine';
import { registeredThemes, initializeThemes } from './assets/catalog';
import { applyThemeInterface } from './assets/interface';
import './assets/theme.css';
import { ArtworkLoader, artworkKey } from './assets/ArtworkLoader';

let connectingParty = false;

const artworkStatus = document.createElement('div');
artworkStatus.className = 'theme-asset-warning';
artworkStatus.setAttribute('role', 'status');
artworkStatus.textContent = 'Loading chamber artwork…';
document.body.append(artworkStatus);
try {
  await initializeThemes();
  artworkStatus.textContent = 'Loading sprite sheets…';
} catch {
  artworkStatus.setAttribute('role', 'alert');
  artworkStatus.textContent = 'Chamber artwork is unavailable. Please reload to retry.';
  const reload = document.createElement('button');
  reload.textContent = 'Retry';
  reload.onclick = () => location.reload();
  artworkStatus.append(reload);
  throw new Error('Artwork initialization failed');
}

let playing = false,
  editing = false,
  screenInitialized = false,
  screenUser: string | null = null,
  screenRoute = '';
let inspection: number | null = null,
  pack: EnvironmentPack = environments.foundry;
let preferredTheme: string | null = null;
let scene: ChamberScene | undefined, client: CoopClient | undefined;
let playtestEngine: GameEngine | null = null;
let playtestView: EditorView = 'author';
const audio = new GameAudio(),
  completed = new Set<number>();
try {
  audio.enabled = localStorage.getItem('weldpoint:sound') !== 'off';
  const savedTheme = localStorage.getItem('weldpoint:theme');
  if (savedTheme && Object.hasOwn(environments, savedTheme)) {
    pack = environments[savedTheme];
    preferredTheme = pack.id;
  }
} catch {
  /* Preferences are optional. */
}
function view() {
  return client?.state?.level ? new RemoteView(client.state.level, client.state, inspection) : null;
}
function refresh() {
  const artworkReady = !!scene?.artworkReady;
  const inLobby = playing && (client?.state?.party ? !client.state.party.started : connectingParty);
  const status = client?.status ?? 'connecting';
  const notice =
    client?.notice ??
    client?.loadingMessage ??
    (!artworkReady && client?.state ? 'Loading chamber artwork…' : null);
  hud.root.hidden = !playing || inLobby;
  lobby.render(
    inLobby,
    client?.state ?? null,
    status,
    client?.notice ?? null,
    client?.loadingMessage ?? null,
  );
  hud.render(
    view(),
    client?.state ?? null,
    status === 'connected' && !artworkReady ? 'connecting' : status,
    notice,
    completed,
    !!client?.canStudy,
    !!client?.otherPerspective,
  );
  explorer.context(client?.state?.publicationKey);
  moveSequence.context(
    auth.user?.id ?? null,
    client?.state?.party?.id,
    client?.state?.moveSequences ?? [],
    inspection ?? client?.state?.history.at(-1)?.step ?? 0,
    playing && !inLobby,
  );
  home.update(audio.enabled, pack.name, completed.size, levels.length, auth.user);
  applyThemeInterface(pack, auth.user, client?.status, !!client?.state?.partnerReady);
}
function queue(direction: Direction) {
  const session = client?.state;
  if (!session || !client?.playable || !scene?.artworkReady || hud.helpOpen || inspection !== null)
    return;
  const error = session.moveErrors[direction];
  if (error) {
    client.showNotice(error);
    return;
  }
  client.send({ type: 'move', direction, revision: session.revision });
}
function command(type: 'undo' | 'reset' | 'cancel') {
  if (!client?.state) return;
  if (type === 'undo' && inspection !== null) {
    inspection = null;
    scene?.redraw();
    return;
  }
  inspection = null;
  client.send({ type, revision: client.state.revision });
}
function level(index: number) {
  if (client?.state) client.send({ type: 'level', index, revision: client.state.revision });
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* Viewport still fills embedded previews. */
  }
}
function toggleTheme() {
  pack = registeredThemes[(registeredThemes.indexOf(pack) + 1) % registeredThemes.length];
  preferredTheme = pack.id;
  try {
    localStorage.setItem('weldpoint:theme', pack.id);
  } catch {}
  scene?.redraw();
  editor.refreshTheme();
  refresh();
}
function toggleSound() {
  audio.enabled = !audio.enabled;
  try {
    localStorage.setItem('weldpoint:sound', audio.enabled ? 'on' : 'off');
  } catch {}
  hud.setSound(audio.enabled);
  refresh();
}
const hud = new Hud(levels, {
  solution: () => {
    void revealSolution();
  },
  home: () => {
    location.hash = '';
  },
  party: () => {
    const state = client?.state;
    if (state?.mode === 'coop') {
      inspection = null;
      hud.clearSolution();
      client?.party({ type: 'lobby', revision: state.revision });
    } else location.hash = 'solo';
  },
  level,
  undo: () => command('undo'),
  reset: () => command('reset'),
  cancel: () => command('cancel'),
  queue,
  fullscreen,
  inspect: (step) => {
    inspection = step === (client?.state?.history.length ?? 0) - 1 ? null : step;
    scene?.redraw();
  },
  theme: toggleTheme,
  sound: toggleSound,
  perspective: () => {
    inspection = null;
    hud.clearSolution();
    client?.togglePerspective();
  },
});
hud.setSound(audio.enabled);
const auth = new AuthClient(() => {
  completed.clear();
  auth.user?.completed.forEach((id) => completed.add(id));
  signin.update();
  editor.setUser(auth.user);
  syncScreen();
  refresh();
  void loadCatalog();
});
const signin = new SignInScreen(auth);
const home = new HomeScreen({
  play: () => {
    location.hash = 'coop';
  },
  solo: () => {
    location.hash = 'solo';
  },
  create: () => {
    location.hash = 'create';
  },
  community: () => {
    location.hash = 'coop/community';
  },
  leaderboard: () => {
    location.hash = 'leaderboard';
  },
  watch: () => {
    location.hash = 'watch';
  },
  sound: toggleSound,
  theme: toggleTheme,
  fullscreen,
  logout: async () => {
    await auth.logout();
    location.hash = '';
  },
});
const watch = new WatchScreen(auth);
const levelApi = new LevelClient(auth);
const explorer = new ArkivPanel(levelApi);
const moveSequence = new MoveSequence(
  levelApi,
  hud.root.querySelector('.timeline-row')!,
  (step) => {
    inspection = step;
    scene?.redraw();
    refresh();
  },
);
const library = new PublishedLevels(levelApi, {
  home: () => {
    location.hash = '';
  },
  fullscreen,
});
const leaderboards = new Leaderboards(levelApi, {
  home: () => {
    location.hash = '';
  },
  fullscreen,
});
const lobby = new PartyLobby({
  leave: () => {
    location.hash = '';
  },
  ready: (ready) => client?.party({ type: 'ready', ready }),
  start: () => client?.party({ type: 'start' }),
  broadcast: (enabled) => client?.party({ type: 'broadcast', enabled }),
  retry: () => client?.retryJoin(),
});
const editor = new EditorScreen(levelApi, {
  home: () => {
    location.hash = '';
  },
  play: (id) => {
    location.hash = 'play/' + id;
  },
  fullscreen,
  onPlaytest: (engine, viewMode, previous, animate, sound) => {
    playtestEngine = engine;
    playtestView = viewMode;
    if (sound) audio.play(sound);
    scene?.redraw(previous, animate);
  },
});
let catalogUser: string | null = null,
  catalogRequest = 0;
async function loadCatalog() {
  const user = auth.user?.id ?? null;
  if (user === catalogUser) return;
  catalogUser = user;
  const request = ++catalogRequest;
  hud.clearSolution();
  levels = [];
  hud.setLevels(levels);
  if (!user) return;
  try {
    const catalog = await levelApi.catalog();
    if (request !== catalogRequest || auth.user?.id !== user) return;
    levels = catalog.campaign;
    hud.setLevels(levels);
    refresh();
  } catch {
    if (request === catalogRequest) catalogUser = null;
  }
}
async function revealSolution() {
  const session = client?.state,
    key = session?.publicationKey,
    user = auth.user?.id;
  if (!key || !session.solutionAvailable) return;
  try {
    const solution = await levelApi.solution(key);
    if (client?.state?.publicationKey === key && auth.user?.id === user) hud.showSolution(solution);
  } catch (error) {
    client?.showNotice((error as Error).message);
  }
}
function syncScreen() {
  const intent = joinIntent(location.hash);
  const browsing =
    !!auth.user && !intent && /^#(?:solo|coop|play|community)(?:\/|$)/.test(location.hash);
  const watching = !!auth.user && /^#watch(?:\/[a-f0-9-]{36})?$/.test(location.hash);
  const ranking = !!auth.user && /^#leaderboard(?:\/[a-f0-9-]{36})?$/.test(location.hash);
  const next = !!auth.user && !!intent;
  const nextEditing = !!auth.user && location.hash === '#create';
  if (
    screenInitialized &&
    next === playing &&
    nextEditing === editing &&
    screenRoute === location.hash &&
    screenUser === (auth.user?.id ?? null)
  )
    return;
  client?.leave();
  client = undefined;
  screenUser = auth.user?.id ?? null;
  screenInitialized = true;
  playing = next;
  editing = nextEditing;
  screenRoute = location.hash;
  inspection = null;
  hud.toggleHelp(false);
  hud.clearSolution();
  if (!editing) playtestEngine = null;
  hud.root.hidden = !playing;
  home.show(!playing && !editing && !browsing && !ranking && !watching && !!auth.user);
  library.show(browsing, location.hash);
  leaderboards.show(ranking, location.hash);
  watch.show(watching, location.hash);
  editor.show(editing);
  signin.update();
  document.body.dataset.screen = playing
    ? 'play'
    : editing
      ? 'creator'
      : browsing || ranking || watching
        ? 'library'
        : auth.user
          ? 'home'
          : 'signin';
  explorer.show(!!auth.user && (editing || browsing), auth.user?.id ?? null);
  connectingParty =
    intent?.kind === 'invite' || (intent?.kind === 'create' && intent.mode === 'coop');
  if (playing && intent) {
    client = new CoopClient(
      receive,
      () => auth.ticket(),
      () => auth.expired(),
      intent,
      (id) => {
        history.replaceState(null, '', '#session/' + id);
        screenRoute = location.hash;
      },
    );
  }
  scene?.redraw();
  refresh();
}
function receive(previous: SessionState | null) {
  const current = client?.state;
  if (!current) {
    refresh();
    return;
  }
  const changed =
    !previous || previous.revision !== current.revision || previous.player !== current.player;
  if (changed) inspection = null;
  const last = current.history.at(-1)!;
  const animate =
    !!previous &&
    current.levelIndex === previous.levelIndex &&
    current.customLevelId === previous.customLevelId &&
    current.player === previous.player &&
    last.step === previous.history.at(-1)!.step + 1;
  if (animate)
    audio.play(
      last.status === 'VICTORY'
        ? 'win'
        : !isLive(last.status)
          ? 'fail'
          : last.status === 'WELD_SUCCESS'
            ? 'weld'
            : current.shove !== null
              ? 'shove'
              : 'step',
    );
  if (
    current.mode === 'coop' &&
    last.status === 'VICTORY' &&
    previous?.history.at(-1)?.status !== 'VICTORY'
  )
    void auth.refresh();
  if (current.campaign) {
    levels = current.campaign;
    hud.setLevels(levels);
  }
  if (previous?.publicationKey !== current.publicationKey) hud.clearSolution();
  if (
    !previous ||
    previous.levelIndex !== current.levelIndex ||
    previous.customLevelId !== current.customLevelId
  ) {
    const environment = preferredTheme ?? current.level?.environment;
    if (environment && environments[environment]) pack = environments[environment];
  }
  const old = animate ? new RemoteView(previous!.level!, previous!).state : undefined;
  refresh();
  scene?.redraw(old, animate);
}
class ChamberScene extends Phaser.Scene {
  private board: BoardView | undefined;
  private title: TitleBackdrop | undefined;
  private artwork!: ArtworkLoader;
  private artworkRequests = new Map<string, Promise<void>>();
  private artworkErrors = new Set<string>();

  constructor() {
    super('chamber');
  }

  private activeEnvironment() {
    const id =
      editing && playtestEngine ? (playtestEngine.level.environment ?? 'foundry') : undefined;
    return id && Object.hasOwn(environments, id) ? environments[id] : pack;
  }

  get artworkReady() {
    return this.artwork.isReady(this.activeEnvironment());
  }

  prepareArtwork(environment: EnvironmentPack): Promise<void> {
    const key = artworkKey(environment);
    const existing = this.artworkRequests.get(key);
    if (existing) {
      if (this.artworkErrors.has(key) && this.activeEnvironment() === environment)
        this.showArtworkError(environment);
      return existing;
    }
    const request = this.artwork.ensure(environment).then(
      () => this.redraw(),
      (error) => {
        this.artworkErrors.add(key);
        console.error('Theme artwork failed', error);
        if (this.activeEnvironment() === environment) this.showArtworkError(environment);
        throw error;
      },
    );
    this.artworkRequests.set(key, request);
    return request;
  }

  private showArtworkError(environment: EnvironmentPack) {
    artworkStatus.setAttribute('role', 'alert');
    artworkStatus.textContent = `${environment.name} artwork could not be loaded. Check your connection and retry.`;
    const retry = document.createElement('button');
    retry.textContent = 'Retry artwork';
    retry.onclick = () => {
      this.artwork.retry(environment);
      this.artworkRequests.delete(artworkKey(environment));
      this.artworkErrors.delete(artworkKey(environment));
      this.redraw();
    };
    artworkStatus.append(retry);
    document.body.append(artworkStatus);
  }

  create() {
    scene = this;
    this.title = new TitleBackdrop(this);
    this.artwork = new ArtworkLoader(
      {
        has: (key) => this.textures.exists(key),
        load: (environment, id, signal) => loadEnvironmentSheet(this, environment, id, signal),
        register: (environment) => buildEnvironment(this, environment),
      },
      (environment, loaded, total) => {
        if (this.activeEnvironment() !== environment) return;
        artworkStatus.setAttribute('role', 'status');
        artworkStatus.textContent = `Loading ${environment.name} artwork… ${loaded}/${total}`;
        document.body.append(artworkStatus);
      },
    );
    this.scale.on('resize', () => this.redraw());
    this.redraw();
  }

  redrawPlaytest(previous?: StepSnapshot, animate = false) {
    if (!playtestEngine) return;
    const id = playtestEngine.level.environment ?? 'foundry';
    const environment = Object.hasOwn(environments, id) ? environments[id] : environments.foundry;
    this.title?.clear();
    this.cameras.main.setBackgroundColor(environment.palette.background);
    const stage = editor.root.querySelector('.creator-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const index = playtestView === 'p1' ? 0 : playtestView === 'p2' ? 1 : 2;
    if (!this.board || this.board.index !== index) {
      this.board?.destroy();
      this.board = new BoardView(this, index);
    }
    this.board.render(
      playtestEngine,
      {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      environment,
      previous,
      animate,
    );
  }

  redraw(previous?: StepSnapshot, animate = false) {
    if (!this.artworkReady) {
      this.board?.destroy();
      this.board = undefined;
      this.title?.clear();
      this.cameras.main.setBackgroundColor(this.activeEnvironment().palette.background);
      void this.prepareArtwork(this.activeEnvironment()).catch(() => {});
      return;
    }
    artworkStatus.remove();
    this.cameras.main.setBackgroundColor(pack.palette.background);
    document.body.dataset.environment = pack.id;
    if (editing) {
      if (playtestEngine) {
        this.redrawPlaytest(previous, animate);
      } else {
        this.board?.destroy();
        this.board = undefined;
        this.title?.clear();
      }
      return;
    }
    if (!playing || client?.state?.party?.started === false) {
      this.board?.destroy();
      this.board = undefined;
      this.title?.draw(this.scale.width, this.scale.height, pack);
      refresh();
      return;
    }
    this.title?.clear();
    const current = view();
    if (current) {
      const study = client?.otherPerspective;
      const index = ((study?.player ?? current.session.player) - 1) as 0 | 1;
      if (!this.board || this.board.index !== index) {
        this.board?.destroy();
        this.board = new BoardView(this, index);
      }
      const width = this.scale.width,
        top = document.querySelector('.mission')!.getBoundingClientRect().bottom + 48;
      const bottom = document.querySelector('.console')!.getBoundingClientRect().top - 10,
        side = width < 700 ? 8 : 24;
      this.board.render(
        study ? new OtherPerspectiveView(study.level) : current,
        { x: side, y: top, width: width - side * 2, height: Math.max(130, bottom - top) },
        pack,
        study ? undefined : previous,
        !study && animate,
      );
    }
    document.body.dataset.environment = pack.id;
    refresh();
  }
}
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#151b1e',
  antialias: false,
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [ChamberScene],
  render: { roundPixels: true },
  audio: { noAudio: true },
});
syncScreen();
void auth.refresh();
window.addEventListener('hashchange', syncScreen);
window.addEventListener('keydown', (e) => {
  if (editing) {
    editor.key(e);
    return;
  }
  const target = e.target as HTMLElement;
  if (target.matches('input,textarea,select')) return;
  if (!playing) {
    if (!auth.user || home.dialogOpen || home.root.hidden) return;
    if (e.code === 'KeyF') {
      e.preventDefault();
      void fullscreen();
    }
    if (e.code === 'Enter' && target.tagName !== 'BUTTON' && target.tagName !== 'A') {
      e.preventDefault();
      location.hash = 'coop';
    }
    return;
  }
  if (!lobby.root.hidden) {
    if (e.code === 'KeyF') {
      e.preventDefault();
      void fullscreen();
    }
    return;
  }
  if (e.code === 'Escape') {
    hud.toggleHelp(false);
    inspection = null;
    scene?.redraw();
    return;
  }
  if (e.code === 'KeyH') {
    e.preventDefault();
    if (!e.repeat) hud.toggleHelp();
    return;
  }
  if (hud.helpOpen) return;
  if (target.tagName === 'BUTTON' && (e.code === 'Enter' || e.code === 'Space')) return;
  if (KEY_MOVES[e.code]) {
    e.preventDefault();
    if (!e.repeat) queue(KEY_MOVES[e.code][1]);
    return;
  }
  if (e.repeat) return;
  if (e.code === 'Backspace' || e.code === 'KeyZ') {
    e.preventDefault();
    command('undo');
  }
  if (e.code === 'KeyR') command('reset');
  if (e.code === 'KeyF') {
    e.preventDefault();
    void fullscreen();
  }
  if (/^Digit[1-9]$/.test(e.code) && Number(e.code.slice(-1)) <= levels.length)
    level(Number(e.code.slice(-1)) - 1);
  if (e.code === 'Digit0' && levels.length >= 10) level(9);
});
// Keep the queued move when switching tabs; it is already acknowledged by the server.
window.addEventListener('pagehide', () => {
  client?.destroy();
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    client?.destroy();
    auth.destroy();
    editor.destroy();
    explorer.destroy();
    moveSequence.destroy();
    library.destroy();
    leaderboards.destroy();
    watch.destroy();
    lobby.destroy();
    home.root.remove();
    signin.root.remove();
    hud.root.remove();
    game.destroy(true);
  });
refresh();
