/**
 * PT-descriptor encoder/decoder per reference/NeoDK/PulseTrainDescr.md.
 *
 * Layout (little-endian, 8-16 bytes beroende på omittnings-regler):
 *   [0]  meta              uint8   (måste vara 0x00)
 *   [1]  sequence_number   uint8   (wraps at 256)
 *   [2]  phase             uint8   (bits 2..1 stage select, bit 0 polarity)
 *   [3]  pulse_width_µs    uint8   (max 200)
 *   [4-7] start_time_µs    uint32  LE
 *   [8-9] electrode_set    uint8×2 (pos mask, neg mask)  -- NeoDK use
 *   [10-11] nr_of_pulses   uint16  LE
 *   [12]   pace_¼ms        uint8
 *   [13]   amplitude       uint8   (0 = "keep previous")
 *   [14]   delta_pulse_width_¼µs  int8
 *   [15]   delta_pace_µs          int8
 *
 * Omit-regler (från slutet, monotont):
 *   delta_pace == 0                        → byte 15 omitted
 *   + delta_pulse_width == 0               → byte 14 omitted
 *   + amplitude == 0                       → byte 13 omitted
 *   + nr_of_pulses == 1                    → bytes 10-12 omitted (pace ignoreras vid nr=1)
 *   + electrode_set ej använt (hardwired)  → bytes 8-9 omitted (NeoDK använder dock alltid)
 *
 * Möjliga sizes (med electrode_set inkluderat): 10, 13, 14, 15, 16.
 *
 * Per outside-voice finding #5: type-safe builder med explicit omit-flags.
 * Round-trip property tests verifierar i descriptor.test.ts.
 */

export interface PtDescriptor {
  /** Måste vara 0x00 (reserverat för framtida versioning) */
  readonly meta: number;
  /** 0..255, wraps */
  readonly sequenceNumber: number;
  /** Bits 2..1 stage select (NeoDK ignorerar — bara 1 transformer), bit 0 polaritet */
  readonly phase: number;
  /** Pulse width µs, 0..200 */
  readonly pulseWidthMicros: number;
  /** Absolute start time µs from stream start */
  readonly startTimeMicros: number;
  /** Bitmask av {A=1, B=2, C=4, D=8} för pos respektive neg */
  readonly electrodeSet: readonly [pos: number, neg: number];
  /** 1..65535 */
  readonly nrOfPulses: number;
  /** Time mellan pulse-starts i 0.25ms-enheter, 0..255 */
  readonly paceQuarterMs: number;
  /** 0..255 voltage scale. 0 = "behåll föregående" (INTE silence) */
  readonly amplitude: number;
  /** Per-pulse pulse_width-delta i 0.25µs-enheter, -128..127 */
  readonly deltaPulseWidthQuarters: number;
  /** Per-pulse pace-delta i µs, -128..127 */
  readonly deltaPaceMicros: number;
}

export class DescriptorEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DescriptorEncodeError';
  }
}

export class DescriptorDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DescriptorDecodeError';
  }
}

export const DESCRIPTOR_MIN_SIZE = 10; // med electrode_set, nr=1, allt annat omitted
export const DESCRIPTOR_MAX_SIZE = 16;

/**
 * Encode a PtDescriptor to wire bytes. Omittar fields som är default-värden.
 * Throws DescriptorEncodeError vid ogiltigt fält-värde.
 */
export function encodeDescriptor(d: PtDescriptor): Uint8Array {
  validateDescriptor(d);

  // Bestäm storlek baserat på vilka fält som kan omittas (monotont från slutet)
  let size: 10 | 13 | 14 | 15 | 16;
  if (d.deltaPaceMicros !== 0) {
    size = 16;
  } else if (d.deltaPulseWidthQuarters !== 0) {
    size = 15;
  } else if (d.amplitude !== 0) {
    size = 14;
  } else if (d.nrOfPulses !== 1) {
    size = 13;
  } else {
    size = 10;
  }

  const buf = new Uint8Array(size);
  buf[0] = d.meta & 0xff;
  buf[1] = d.sequenceNumber & 0xff;
  buf[2] = d.phase & 0xff;
  buf[3] = d.pulseWidthMicros & 0xff;
  // start_time_µs: little-endian uint32
  buf[4] = d.startTimeMicros & 0xff;
  buf[5] = (d.startTimeMicros >>> 8) & 0xff;
  buf[6] = (d.startTimeMicros >>> 16) & 0xff;
  buf[7] = (d.startTimeMicros >>> 24) & 0xff;
  // electrode_set
  buf[8] = d.electrodeSet[0] & 0xff;
  buf[9] = d.electrodeSet[1] & 0xff;
  if (size >= 13) {
    // nr_of_pulses LE u16, pace ¼ms
    buf[10] = d.nrOfPulses & 0xff;
    buf[11] = (d.nrOfPulses >>> 8) & 0xff;
    buf[12] = d.paceQuarterMs & 0xff;
  }
  if (size >= 14) {
    buf[13] = d.amplitude & 0xff;
  }
  if (size >= 15) {
    buf[14] = signedByteToWire(d.deltaPulseWidthQuarters);
  }
  if (size >= 16) {
    buf[15] = signedByteToWire(d.deltaPaceMicros);
  }
  return buf;
}

/**
 * Decode wire bytes till PtDescriptor. Default-fyller omitted fält.
 * Throws DescriptorDecodeError om size inte är giltig eller meta != 0.
 */
export function decodeDescriptor(bytes: Uint8Array): PtDescriptor {
  const size = bytes.length;
  const validSizes = [10, 13, 14, 15, 16];
  if (!validSizes.includes(size)) {
    throw new DescriptorDecodeError(
      `Invalid descriptor size ${size}, must be one of ${validSizes.join(', ')}`,
    );
  }
  const meta = bytes[0]!;
  if (meta !== 0x00) {
    throw new DescriptorDecodeError(`meta byte must be 0x00, got 0x${meta.toString(16)}`);
  }
  return {
    meta,
    sequenceNumber: bytes[1]!,
    phase: bytes[2]!,
    pulseWidthMicros: bytes[3]!,
    startTimeMicros:
      bytes[4]! |
      (bytes[5]! << 8) |
      (bytes[6]! << 16) |
      (bytes[7]! * 0x1000000), // multiply for u32 (avoid sign extension at bit 31)
    electrodeSet: [bytes[8]!, bytes[9]!],
    // Omitted fields → defaults per spec
    nrOfPulses: size >= 13 ? bytes[10]! | (bytes[11]! << 8) : 1,
    paceQuarterMs: size >= 13 ? bytes[12]! : 0,
    amplitude: size >= 14 ? bytes[13]! : 0,
    deltaPulseWidthQuarters: size >= 15 ? wireToSignedByte(bytes[14]!) : 0,
    deltaPaceMicros: size >= 16 ? wireToSignedByte(bytes[15]!) : 0,
  };
}

/** Validera descriptor-fält innan encoding. */
function validateDescriptor(d: PtDescriptor): void {
  if (d.meta !== 0x00) {
    throw new DescriptorEncodeError(`meta must be 0x00, got 0x${d.meta.toString(16)}`);
  }
  assertU8('sequenceNumber', d.sequenceNumber);
  assertU8('phase', d.phase);
  assertU8('pulseWidthMicros', d.pulseWidthMicros);
  if (d.pulseWidthMicros > 200) {
    throw new DescriptorEncodeError(`pulseWidthMicros ${d.pulseWidthMicros} > 200 (spec max)`);
  }
  if (
    !Number.isInteger(d.startTimeMicros) ||
    d.startTimeMicros < 0 ||
    d.startTimeMicros > 0xffff_ffff
  ) {
    throw new DescriptorEncodeError(
      `startTimeMicros ${d.startTimeMicros} out of u32 range`,
    );
  }
  assertU8('electrodeSet[0]', d.electrodeSet[0]);
  assertU8('electrodeSet[1]', d.electrodeSet[1]);
  if (d.electrodeSet[0] > 15 || d.electrodeSet[1] > 15) {
    throw new DescriptorEncodeError(
      `electrodeSet masks exceed 4-electrode range (0-15): [${d.electrodeSet[0]}, ${d.electrodeSet[1]}]`,
    );
  }
  if ((d.electrodeSet[0] & d.electrodeSet[1]) !== 0) {
    throw new DescriptorEncodeError(
      `Short circuit: electrodeSet pos & neg overlap (pos=${d.electrodeSet[0]}, neg=${d.electrodeSet[1]})`,
    );
  }
  if (
    !Number.isInteger(d.nrOfPulses) ||
    d.nrOfPulses < 1 ||
    d.nrOfPulses > 0xffff
  ) {
    throw new DescriptorEncodeError(`nrOfPulses ${d.nrOfPulses} out of u16 range (1..65535)`);
  }
  assertU8('paceQuarterMs', d.paceQuarterMs);
  assertU8('amplitude', d.amplitude);
  assertI8('deltaPulseWidthQuarters', d.deltaPulseWidthQuarters);
  assertI8('deltaPaceMicros', d.deltaPaceMicros);
}

function assertU8(field: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 255) {
    throw new DescriptorEncodeError(`${field} ${v} out of u8 range (0..255)`);
  }
}

function assertI8(field: string, v: number): void {
  if (!Number.isInteger(v) || v < -128 || v > 127) {
    throw new DescriptorEncodeError(`${field} ${v} out of i8 range (-128..127)`);
  }
}

function signedByteToWire(v: number): number {
  return v < 0 ? v + 256 : v;
}

function wireToSignedByte(b: number): number {
  return b > 127 ? b - 256 : b;
}
