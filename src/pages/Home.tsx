import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronLeft, CircleHelp, Copy, MousePointer2, Palette, Pause, Play, RotateCcw, Trophy, Users, Volume2, VolumeX, Wifi, X, Share2 } from "lucide-react";
import { startGame, stopGame } from "@/game/boot";
import type { GameController, GameUIState } from "@/game/types";
import type { Difficulty } from "@/game/ai";
import { NATIONAL_TEAMS, NATIONAL_TEAM_FLAG_CODES, getNationalTeam, getTeamsByConfederation, type Confederation, type NationalTeam } from "@/game/teams";
import { storage } from "@/game/storage";

type Panel = "main" | "single" | "online" | "settings" | "help";

const DIFFICULTIES: Array<{ id: Difficulty; title: string; text: string; bars: number }> = [
  { id: "easy", title: "Новичок", text: "Медленная реакция и больше неточностей", bars: 1 },
  { id: "normal", title: "Любитель", text: "Сбалансированные скорость и точность", bars: 2 },
  { id: "hard", title: "Профи", text: "Быстрая реакция и точное позиционирование", bars: 3 },
];

const COLORS = ["#27d3a2", "#38a8ff", "#ef476f", "#f4b942", "#f7fbff", "#9b7bff", "#202b36"];

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef<GameController | null>(null);
  const [ui, setUi] = useState<GameUIState | null>(null);
  const [panel, setPanel] = useState<Panel>("main");
  const [roomCode, setRoomCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(() => storage.get<string>("spinRally.team", "rus"));
  const [teamRegion, setTeamRegion] = useState<Confederation | "All">("All");
  const visibleTeams = getTeamsByConfederation(teamRegion);
  const selectedTeam = getNationalTeam(selectedTeamId) ?? NATIONAL_TEAMS[11];
  const rivalTeam = getNationalTeam("chn") ?? NATIONAL_TEAMS[0];
  const teamForSide = (side: 0 | 1) => side === (ui?.ownSide ?? 0) ? selectedTeam : rivalTeam;
  const chooseTeam = (id: string) => { setSelectedTeamId(id); storage.set("spinRally.team", id); };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    controller.current = startGame(canvas, setUi);
    return () => stopGame();
  }, []);

  const goTitle = () => {
    controller.current?.showTitle();
    setPanel("main");
    setCopied(false);
  };

  const inviteUrl = ui?.roomId ? `${location.origin}${location.pathname}?room=${ui.roomId}` : "";
  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API is unavailable on some mobile browsers and non-HTTPS previews.
      try {
        const field = document.createElement("textarea");
        field.value = inviteUrl;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const ok = document.execCommand("copy");
        field.remove();
        setCopied(ok);
        if (ok) window.setTimeout(() => setCopied(false), 1800);
      } catch { setCopied(false); }
    }
  };
  const shareInvite = async () => {
    if (!inviteUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: "Spin Rally — сыграем?", text: "Присоединяйся ко мне в настольный теннис!", url: inviteUrl }); }
      catch { /* Share sheet dismissed by the user. */ }
    } else { await copyInvite(); }
  };

  const updateColor = (key: "kit" | "paddle" | "ball", value: string) => {
    if (!ui) return;
    controller.current?.updateSettings({ ...ui.settings, [key]: value });
  };

  const waitingOnline = ui?.mode === "online" && (!ui.peerConnected || ui.networkStatus !== "connected");

  return (
    <div id="game-root">
      <canvas id="game-canvas" ref={canvasRef} />
      <div id="ui-overlay">
        {!ui && <div className="loading-screen"><span className="loader" />Загрузка корта…</div>}

        {ui?.mode === "title" && (
          <>
            <header className="title-topbar">
              <div className="brand-mini"><span className="brand-ball" />SPIN RALLY</div>
              <button className="icon-button glass" onClick={() => controller.current?.toggleMute()} aria-label="Звук">
                {ui.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
            </header>
            <main className="title-layout">
              <section className="hero-copy">
                <div className="eyebrow"><span /> БРАУЗЕРНЫЙ НАСТОЛЬНЫЙ ТЕННИС</div>
                <h1>SPIN<br /><em>RALLY</em></h1>
                <p>Чувствуй вращение. Читай отскок.<br />Выигрывай розыгрыш.</p>
                <div className="feature-pills"><span>Физическая модель мяча</span><span>Онлайн 1 × 1</span><span>ПК + телефон</span></div>
              </section>
              <section className="menu-card glass-strong">
                {panel === "main" && (
                  <>
                    <div className="menu-heading"><span>ВЫБЕРИ РЕЖИМ</span><small>Матч до двух партий</small></div>
                    <button className="mode-button primary" onClick={() => setPanel("single")}>
                      <span className="mode-icon"><Bot /></span><span><b>Одиночный матч</b><small>Три уровня сложности</small></span><Play size={18} />
                    </button>
                    <button className="mode-button" onClick={() => setPanel("online")}>
                      <span className="mode-icon"><Users /></span><span><b>Онлайн с другом</b><small>Комната по короткому коду</small></span><Wifi size={18} />
                    </button>
                    <div className="menu-row">
                      <button className="sub-button" onClick={() => setPanel("settings")}><Palette size={18} />Форма и инвентарь</button>
                      <button className="sub-button" onClick={() => setPanel("help")}><CircleHelp size={18} />Как играть</button>
                    </div>
                    <div className="quick-start"><kbd>SPACE</kbd> быстрый матч с новичком</div>
                  </>
                )}
                {panel === "single" && (
                  <>
                    <PanelTitle title="СЛОЖНОСТЬ" subtitle="Уровень меняет реакцию, скорость и точность" onBack={() => setPanel("main")} />
                    <div className="difficulty-list">
                      {DIFFICULTIES.map((level) => (
                        <button className="difficulty" key={level.id} onClick={() => controller.current?.startSingle(level.id)}>
                          <span><b>{level.title}</b><small>{level.text}</small></span>
                          <span className="difficulty-bars">{[1, 2, 3].map((bar) => <i key={bar} className={bar <= level.bars ? "active" : ""} />)}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {panel === "online" && (
                  <>
                    <PanelTitle title="МАТЧ С ДРУГОМ" subtitle="Ссылка подключит друга автоматически" onBack={() => setPanel("main")} />
                    <button className="mode-button primary compact" onClick={() => controller.current?.createRoom()}><span className="mode-icon"><Users /></span><span><b>Создать комнату</b><small>Получить код для друга</small></span></button>
                    <div className="divider"><span>или присоединиться</span></div>
                    <div className="join-row">
                      <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="КОД ИЗ 6 СИМВОЛОВ" aria-label="Код комнаты" onKeyDown={(event) => { if (event.key === "Enter") controller.current?.joinRoom(roomCode); }} />
                      <button className="accent-button" onClick={() => controller.current?.joinRoom(roomCode)}>Войти</button>
                    </div>
                    <p className="menu-note">Оба игрока должны открыть одну и ту же опубликованную версию игры.</p>
                  </>
                )}
                {panel === "settings" && ui && (
                  <>
                    <PanelTitle title="ТВОЙ СТИЛЬ" subtitle="Настройки сохранятся в этом браузере" onBack={() => setPanel("main")} />
                    <label className="name-field">ИМЯ НА ТАБЛО<input value={ui.settings.name} maxLength={16} onChange={(event) => controller.current?.updateSettings({ ...ui.settings, name: event.target.value })} /></label>
                    <ColorPicker label="Цвет формы" value={ui.settings.kit} onChange={(value) => updateColor("kit", value)} />
                    <ColorPicker label="Цвет ракетки" value={ui.settings.paddle} onChange={(value) => updateColor("paddle", value)} />
                    <ColorPicker label="Цвет мяча" value={ui.settings.ball} onChange={(value) => updateColor("ball", value)} />
                    <div className="team-picker"><div className="team-picker-heading"><b>НАЦИОНАЛЬНАЯ СБОРНАЯ</b><small>Флаг и эмблема появятся на табло</small></div><div className="team-filters" role="group" aria-label="Фильтр сборных">
                        {([{ id: "All", label: "Все" }, { id: "Asia", label: "Азия" }, { id: "Europe", label: "Европа" }, { id: "Africa", label: "Африка" }, { id: "Americas", label: "Америка" }] as const).map((region) => <button type="button" key={region.id} className={teamRegion === region.id ? "active" : ""} onClick={() => setTeamRegion(region.id)} aria-pressed={teamRegion === region.id}>{region.label}</button>)}
                      </div>
                      <div className="team-grid">{visibleTeams.map((team) => <button type="button" key={team.id} className={`team-option ${selectedTeam.id === team.id ? "selected" : ""}`} onClick={() => chooseTeam(team.id)} aria-pressed={selectedTeam.id === team.id}><TeamCrest team={team} /><TeamFlag team={team} /><span>{team.name}</span></button>)}</div></div>
                    <div className="preview-note"><span className="preview-ball" style={{ background: ui.settings.ball }} /> В сетевом матче используется мяч хозяина комнаты</div>
                  </>
                )}
                {panel === "help" && (
                  <>
                    <PanelTitle title="КАК ИГРАТЬ" subtitle="Простое управление — глубокая механика" onBack={() => setPanel("main")} />
                    <div className="help-list">
                      <div><MousePointer2 /><span><b>Двигай ракетку</b><small>Мышь или палец задают положение, скорость и естественный угол. На ПК также доступны WASD и стрелки.</small></span></div>
                      <div><MousePointer2 /><span><b>Создавай вращение</b><small>Проводи ракеткой по мячу: движение вверх/вниз и в стороны создаёт топспин, подрезку и боковое вращение.</small></span></div>
                      <div><MousePointer2 /><span><b>Подача</b><small>Нажми левую кнопку мыши или кнопку подачи, когда наступит твоя очередь.</small></span></div>
                      <div><Trophy /><span><b>Счёт</b><small>11 очков с преимуществом 2. Две подачи, при 10:10 — по одной.</small></span></div>
                    </div>
                  </>
                )}
              </section>
            </main>
            <footer className="title-footer"><span>ITTF-пропорции стола</span><span>Физика вращения Magnus</span><span>240 Hz симуляция</span></footer>
          </>
        )}

        {ui && ui.mode !== "title" && (
          <>
            <div className="game-topbar">
              <button className="icon-button glass" onClick={goTitle} aria-label="Выйти в меню"><X size={20} /></button>
              <div className="scoreboard glass-strong">
                <PlayerScore name={ui.players[0].name} color={ui.players[0].kit} team={teamForSide(0)} score={ui.state.scores[0]} games={ui.state.games[0]} serving={ui.state.server === 0 && ui.state.phase === "serve"} />
                <div className="score-center"><span>ПАРТИЯ {ui.state.gameNumber}</span><b>:</b><small>до 2 побед</small></div>
                <PlayerScore name={ui.players[1].name} color={ui.players[1].kit} team={teamForSide(1)} score={ui.state.scores[1]} games={ui.state.games[1]} serving={ui.state.server === 1 && ui.state.phase === "serve"} right />
              </div>
              <div className="game-actions">
                <button className="icon-button glass" onClick={() => controller.current?.toggleMute()} aria-label="Звук">{ui.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
                {ui.mode === "single" && <button className="icon-button glass" onClick={() => controller.current?.togglePause()} aria-label="Пауза"><Pause size={19} /></button>}
              </div>
            </div>
            <div className="judge-call glass"><span className="judge-dot" /> <b>СУДЬЯ</b><span>{ui.state.message}</span></div>
            <div className="match-meta glass">
              {ui.mode === "online" ? <><Wifi size={14} /><span>{ui.roomId || "…"}</span><i />{ui.ping} мс</> : <><Bot size={14} />{DIFFICULTIES.find((item) => item.id === ui.difficulty)?.title}</>}
            </div>
            {ui.state.phase === "serve" && ui.state.server === ui.ownSide && !waitingOnline && (
              <button className="serve-button" onClick={() => controller.current?.serve()}><span>ПОДАЧА</span><small>Пробел или нажми</small></button>
            )}
            <div className="control-hint glass"><MousePointer2 size={15} /><span>Мышь — ракетка и вращение</span><i />W/S — выше/ниже · A/D — влево/вправо · клик — подача</div>
          </>
        )}

        {waitingOnline && ui && (
          <div className="modal-backdrop">
            <section className="dialog lobby-dialog glass-strong">
              <div className="live-indicator"><span />{ui.networkStatus === "connecting" ? "ПОДКЛЮЧЕНИЕ" : "КОМНАТА ОТКРЫТА"}</div>
              <h2>{ui.networkStatus === "disconnected" ? "Соединение потеряно" : "Ждём соперника"}</h2>
              <p>{ui.networkStatus === "disconnected" ? "Вернись в меню и попробуй подключиться снова." : "Отправь другу ссылку — он подключится автоматически. Можно также ввести код вручную."}</p>
              {ui.roomId && <>
                <div className="room-code"><span>{ui.roomId}</span></div>
                <button className="accent-button wide" onClick={copyInvite}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Ссылка скопирована" : "Скопировать приглашение"}</button>
                <button className="secondary-button wide" onClick={shareInvite}><Share2 size={17} />Отправить другу</button>
              </>}
              <div className="lobby-status"><span className="loader" />{ui.networkError || "Ожидание второго игрока…"}</div>
              {ui.networkStatus === "disconnected" && ui.roomId && <button className="accent-button wide" onClick={() => controller.current?.joinRoom(ui.roomId)}>Переподключиться</button>}
              <button className="secondary-button" onClick={goTitle}><ChevronLeft size={17} />Вернуться в меню</button>
            </section>
          </div>
        )}

        {ui?.mode !== "title" && ui?.paused && (
          <div className="modal-backdrop">
            <section className="dialog glass-strong"><span className="dialog-icon"><Pause /></span><h2>Пауза</h2><p>Розыгрыш остановлен. Возвращайся на корт, когда будешь готов.</p><button className="accent-button wide" onClick={() => controller.current?.togglePause()}><Play size={17} />Продолжить</button><button className="secondary-button wide" onClick={() => controller.current?.rematch()}><RotateCcw size={17} />Начать матч заново</button><button className="text-button" onClick={goTitle}>Выйти в меню</button></section>
          </div>
        )}

        {ui?.mode !== "title" && ui?.state.phase === "gameover" && (
          <div className="modal-backdrop">
            <section className="dialog result-dialog glass-strong"><span className="trophy"><Trophy /></span><div className="eyebrow centered">МАТЧ ЗАВЕРШЁН</div><h2>{ui.state.winner === ui.ownSide ? "Победа!" : "Хороший матч"}</h2><p>{ui.state.winner !== null ? ui.players[ui.state.winner].name : "Игрок"} выигрывает со счётом</p><div className="final-score"><b>{ui.state.games[0]}</b><span>:</span><b>{ui.state.games[1]}</b></div><button className="accent-button wide" onClick={() => controller.current?.rematch()}><RotateCcw size={17} />Реванш</button><button className="secondary-button wide" onClick={goTitle}>Главное меню</button></section>
          </div>
        )}

        {ui?.mode === "online" && ui.networkError && !waitingOnline && <div className="error-toast">{ui.networkError}</div>}
      </div>
    </div>
  );
}

function PanelTitle({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) {
  return <div className="panel-title"><button className="icon-button" onClick={onBack}><ChevronLeft size={19} /></button><div><span>{title}</span><small>{subtitle}</small></div></div>;
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="color-field"><span>{label}</span><div className="swatches">{COLORS.map((color) => <button key={color} className={value === color ? "selected" : ""} style={{ background: color }} onClick={() => onChange(color)} aria-label={`${label}: ${color}`}>{value === color && <Check size={13} />}</button>)}<label className="custom-color" style={{ background: value }}><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><Palette size={13} /></label></div></div>;
}

function PlayerScore({ name, color, team, score, games, serving, right = false }: { name: string; color: string; team: NationalTeam; score: number; games: number; serving: boolean; right?: boolean }) {
  return <div className={`player-score ${right ? "right" : ""}`}><div className="player-info"><span className="player-name"><i style={{ background: color }} /><TeamFlag team={team} /> {name || "Игрок"}{serving && <span className="serve-dot" title="Подача" />}</span><small><TeamCrest team={team} /> {team.shortName} · Партии: {games}</small></div><b>{score}</b></div>;
}



function TeamFlag({ team }: { team: NationalTeam }) {
  const code = NATIONAL_TEAM_FLAG_CODES[team.id];
  return <img className="team-flag-image" src={`https://flagcdn.com/w40/${code}.png`} alt={`Флаг: ${team.name}`} loading="lazy" />;
}

function TeamCrest({ team }: { team: NationalTeam }) {
  const { primary, secondary, accent, initials } = team.crest;
  return <svg className="team-crest" viewBox="0 0 40 46" role="img" aria-label={`Эмблема сборной ${team.name}`}><path d="M20 2 36 8v13c0 10-6 17-16 23C10 38 4 31 4 21V8z" fill={primary} stroke={secondary} strokeWidth="2"/><path d="M20 7 31 11v10c0 7-4 12-11 17-7-5-11-10-11-17V11z" fill="none" stroke={accent} strokeWidth="1.2"/><circle cx="20" cy="19" r="8" fill={secondary} opacity=".94"/><text x="20" y="22.5" textAnchor="middle" fontSize="9" fontWeight="800" fill={primary}>{initials}</text><path d="m20 29 2 4 4 .5-3 3 .7 4.2-3.7-2-3.7 2 .7-4.2-3-3 4-.5z" fill={accent}/></svg>;
}
