import { DEFAULT_INPUT, TABLE, type PaddleInput, type TableTennisSim } from "@contracts/sim";
export type Difficulty = "easy" | "normal" | "hard";
const LEVELS={easy:{reaction:0.20,speed:0.72,error:0.10},normal:{reaction:0.09,speed:0.91,error:0.035},hard:{reaction:0.05,speed:1,error:0.012}} as const;

export class TableTennisAI {
  private think=0;private clock=0;private serveDelay=0;private lastBounces=0;
  private input:PaddleInput={...DEFAULT_INPUT,z:-1.4};
  constructor(private difficulty:Difficulty="normal"){}
  reset():void{this.think=0;this.serveDelay=0;this.lastBounces=0;this.input={...DEFAULT_INPUT,z:-1.4};}
  update(sim:TableTennisSim,dt:number):void{
    const level=LEVELS[this.difficulty],state=sim.state;this.clock+=dt;this.think-=dt;this.serveDelay+=dt;
    this.input.serve=false;this.input.power=false;this.input.slice=false;
    if(state.phase==="serve"){
      this.input.x+=(0-this.input.x)*dt*3;this.input.y+=(1.17-this.input.y)*dt*3;this.input.z+=(-1.4-this.input.z)*dt*3;
      if(state.server===1&&this.serveDelay>0.8){this.input.serve=true;this.serveDelay=0;}
      sim.setInput(1,this.input);return;
    }
    if(state.phase!=="rally"){this.serveDelay=0;sim.setInput(1,this.input);return;}
    const ball=state.ball;
    if(ball.bounces!==this.lastBounces){this.lastBounces=ball.bounces;this.think=0;}
    if(ball.v.z<0&&this.think<=0){
      this.think=level.reaction;
      const planeZ=-1.39,t=Math.max(0.025,Math.min(1.2,(planeZ-ball.p.z)/ball.v.z));
      const error=Math.sin(this.clock*7.13+state.rallyHits*2.7)*level.error;
      // Predict a short ballistic segment. Spin is included as a small lateral/lift correction.
      const x=ball.p.x+ball.v.x*t+0.5*(ball.spin.y*ball.v.z-ball.spin.z*ball.v.y)*0.00030*t*t+error;
      let y=ball.p.y+ball.v.y*t-4.905*t*t+0.5*(ball.spin.z*ball.v.x-ball.spin.x*ball.v.z)*0.00030*t*t;
      // If the projected path reaches the tabletop before the racket plane,
      // predict the post-bounce arc instead of aiming at the pre-bounce height.
      const tableHeight=TABLE.y+TABLE.ballRadius;
      const groundDisc=ball.v.y*ball.v.y+2*9.81*(ball.p.y-tableHeight);
      if(groundDisc>=0){
        const timeToTable=(ball.v.y+Math.sqrt(groundDisc))/9.81;
        if(timeToTable>0&&timeToTable<t){
          const impactVy=ball.v.y-9.81*timeToTable;
          const reboundVy=-impactVy*0.88;
          const afterBounce=t-timeToTable;
          y=tableHeight+reboundVy*afterBounce-4.905*afterBounce*afterBounce;
        }
      }
      y=Math.max(tableHeight+0.025,y);
      const sideStep=Math.sin(this.clock*2.7+state.rallyHits)*0.035;
      // Prepare behind/below the contact point, then accelerate upward through it.
      const swing=t<0.30;
      const targetX=x+(swing?0.025:-0.035)+sideStep;
      const targetY=y+(swing?0.02:-0.22);
      this.input.x=Math.max(-0.94,Math.min(0.94,targetX));
      this.input.y=Math.max(0.87,Math.min(1.66,targetY));
      this.input.z=(swing&&(!ball.serve||ball.bounces>=2))?-1.25:-1.4;
    }else if(ball.v.z>=0){
      this.input.x+=(0-this.input.x)*dt*2.4*level.speed;
      this.input.y+=(1.18-this.input.y)*dt*2.4;
    }
    this.input.x=Math.max(-1,Math.min(1,this.input.x));
    sim.setInput(1,this.input);
  }
}
