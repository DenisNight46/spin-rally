import type { ClientMessage, ServerMessage } from "@contracts/network";
import type { MatchState, PaddleInput, PlayerSettings, Side } from "@contracts/sim";

interface Snapshot { at: number; state: MatchState }
const INTERPOLATION_DELAY = 95;

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}

export class NetworkClient {
  private socket: WebSocket | null = null;
  private pingTimer = 0;
  private snapshots: Snapshot[] = [];
  ping = 0;
  onMessage: (message: ServerMessage) => void = () => {};
  onStatus: (status: "connecting" | "connected" | "disconnected") => void = () => {};

  connect(action: "create" | "join", settings: PlayerSettings, roomId?: string): void {
    this.closeSocket(); this.snapshots=[]; this.onStatus("connecting");
    const protocol=location.protocol==="https:"?"wss":"ws";
    const socket=new WebSocket(`${protocol}://${location.host}/ws`);this.socket=socket;
    socket.addEventListener("open",()=>{
      if(this.socket!==socket)return;this.onStatus("connected");
      this.send(action==="create"?{type:"create",settings}:{type:"join",settings,roomId:roomId??""});
      this.pingTimer=window.setInterval(()=>this.send({type:"ping",at:performance.now()}),2000);
    });
    socket.addEventListener("message",event=>{
      if(this.socket!==socket)return;
      try{
        const message=JSON.parse(String(event.data)) as ServerMessage;
        if(message.type==="pong")this.ping=Math.max(0,Math.round(performance.now()-message.at));
        if(message.type==="state"){
          this.snapshots.push({at:performance.now(),state:cloneState(message.state)});
          if(this.snapshots.length>12)this.snapshots.shift();
        }
        this.onMessage(message);
      }catch{/* Ignore malformed packets; the next authoritative snapshot repairs the view. */}
    });
    socket.addEventListener("close",()=>{if(this.socket!==socket)return;window.clearInterval(this.pingTimer);this.onStatus("disconnected");});
    socket.addEventListener("error",()=>{if(this.socket===socket)this.onStatus("disconnected");});
  }

  /** Render-only interpolation behind real time; gameplay decisions remain server authoritative. */
  getInterpolatedState(now=performance.now()): MatchState | null {
    if(!this.snapshots.length)return null;
    const target=now-INTERPOLATION_DELAY;
    let a=this.snapshots[0],b=this.snapshots[this.snapshots.length-1];
    for(let i=1;i<this.snapshots.length;i++){
      if(this.snapshots[i].at>=target){a=this.snapshots[i-1];b=this.snapshots[i];break;}
    }
    if(a===b||b.at<=a.at)return cloneState(b.state);
    const t=Math.max(0,Math.min(1,(target-a.at)/(b.at-a.at)));
    const out=cloneState(t<0.5?a.state:b.state);
    const mix=(x:number,y:number)=>lerp(x,y,t);
    for(const key of ["x","y","z"] as const){
      out.ball.p[key]=mix(a.state.ball.p[key],b.state.ball.p[key]);
      out.ball.v[key]=mix(a.state.ball.v[key],b.state.ball.v[key]);
      out.ball.spin[key]=mix(a.state.ball.spin[key],b.state.ball.spin[key]);
    }
    for(const side of [0,1] as Side[]){
      for(const key of ["x","y","z","vx","vy","vz"] as const){
        out.paddles[side][key]=mix(a.state.paddles[side][key],b.state.paddles[side][key]);
      }
    }
    return out;
  }

  send(message:ClientMessage):void{if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  sendInput(input:PaddleInput):void{this.send({type:"input",input});}
  private closeSocket():void{window.clearInterval(this.pingTimer);this.pingTimer=0;const socket=this.socket;this.socket=null;if(socket&&socket.readyState<WebSocket.CLOSING)socket.close();}
  dispose():void{this.closeSocket();this.snapshots=[];this.onStatus=()=>{};this.onMessage=()=>{};}
}
