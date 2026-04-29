import { Encoding } from './opcodes';

export interface Voltages {
  Vbat_mV: number;
  Vcap_mV: number;
  Iprim_mA: number;
}

/** Encode a Voltages payload: marker + len + 6 data bytes (3× u16 LE). */
export function encodeVoltages(v: Voltages): Uint8Array {
  const buf = new Uint8Array(8);
  buf[0] = Encoding.Bytes_1Len;
  buf[1] = 6;
  buf[2] = v.Vbat_mV & 0xff;
  buf[3] = (v.Vbat_mV >> 8) & 0xff;
  buf[4] = v.Vcap_mV & 0xff;
  buf[5] = (v.Vcap_mV >> 8) & 0xff;
  buf[6] = v.Iprim_mA & 0xff;
  buf[7] = (v.Iprim_mA >> 8) & 0xff;
  return buf;
}

export function decodeVoltages(payload: Uint8Array): Voltages | null {
  if (payload.length < 8 || payload[0] !== Encoding.Bytes_1Len) return null;
  return {
    Vbat_mV: payload[2]! | (payload[3]! << 8),
    Vcap_mV: payload[4]! | (payload[5]! << 8),
    Iprim_mA: payload[6]! | (payload[7]! << 8),
  };
}

export function encodeUInt1(value: number): Uint8Array {
  return new Uint8Array([Encoding.UnsignedInt1, value & 0xff]);
}

export function decodeUInt1(payload: Uint8Array): number | null {
  if (payload.length < 2 || payload[0] !== Encoding.UnsignedInt1) return null;
  return payload[1] ?? null;
}

export function encodeUTF8String(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  if (enc.length > 255) throw new Error(`String too long: ${enc.length}`);
  const buf = new Uint8Array(2 + enc.length);
  buf[0] = Encoding.UTF8_1Len;
  buf[1] = enc.length;
  buf.set(enc, 2);
  return buf;
}

export function decodeUTF8String(payload: Uint8Array): string | null {
  if (payload.length < 2 || payload[0] !== Encoding.UTF8_1Len) return null;
  const len = payload[1]!;
  if (payload.length < 2 + len) return null;
  return new TextDecoder().decode(payload.slice(2, 2 + len));
}
