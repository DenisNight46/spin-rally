import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronLeft, CircleHelp, Copy, MousePointer2, Palette, Pause, Play, RotateCcw, Trophy, Users, Volume2, VolumeX, Wifi, X, Share2 } from "lucide-react";
import { startGame, stopGame } from "@/game/boot";
import type { GameController, GameUIState } from "@/game/types";
import type { Difficulty } from "@/game/ai";
import { NATIONAL_TEAMS, NATIONAL_TEAM_FLAG_CODES, getNationalTeam, getTeamsByConfederation, type Confederation, type NationalTeam } from "@/game/teams";
import { storage } from "@/game/storage";
import { getTrainingProgress } from "@/game/training";
import { initializeTelegramMiniApp } from "@/platform/telegram";

type Panel = "main" | "single" | "training" | "online" | "settings" | "help";

const DIFFICULTIES: Array<{ id: Difficulty; title: string; text: string; bars: number }> = [
  { id: "easy", title: "Новичок", text: "Играет в центр, медленнее реагирует и чаще ошибается", bars: 1 },
  { id: "normal", title: "Любитель", text: "Чередует направления и вращение, заставляет двигаться", bars: 2 },
  { id: "hard", title: "Профи", text: "Предугадывает движение и атакует свободную сторону", bars: 3 },
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
  const trainingProgress = ui ? getTrainingProgress(ui.state.rallyHits, ui.trainingBest) : null;
  const chooseTeam = (id: string) => { setSelectedTeamId(id); storage.set("spinRally.team", id); };

  useEffect(() => {
    const disposeTelegram = initializeTelegramMiniApp();
    const canvas = canvasRef.current;
    if (!canvas) return;
    controller.current = startGame(canvas, setUi);
    return () => { stopGame(); disposeTelegram(); };
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