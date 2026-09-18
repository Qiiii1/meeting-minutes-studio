// The owning AudioContext runs at 16 kHz. 640 mono samples = 40 ms / 1280 bytes.
class MinutesPCM extends AudioWorkletProcessor {
  constructor(){super();this.frame=new ArrayBuffer(1280);this.view=new DataView(this.frame);this.offset=0;}
  process(inputs){
    const channel=inputs[0]?.[0];
    if(!channel)return true;
    for(const value of channel){
      const sample=Math.max(-1,Math.min(1,value));
      this.view.setInt16(this.offset,sample<0?sample*32768:sample*32767,true);
      this.offset+=2;
      if(this.offset===1280){
        this.port.postMessage(this.frame,[this.frame]);
        this.frame=new ArrayBuffer(1280);this.view=new DataView(this.frame);this.offset=0;
      }
    }
    return true;
  }
}
registerProcessor('minutes-pcm',MinutesPCM);
