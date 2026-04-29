/**
 * NeoDK protocol constants — matches reference/NeoDK/UI/neodk.js byte-for-byte.
 *
 * Frame layout (8 bytes):
 *   byte 0: (service_type << 4) | (frame_type << 1) | ack_flag
 *   byte 1: (seq << 3) | ack
 *   byte 2-3: payload size (big-endian, max 512)
 *   byte 4: reserved (0)
 *   byte 5: CRC8 over bytes 0..4
 *   byte 6-7: CRC16-CCITT over bytes 0..5 + payload
 */

export const FrameType = {
  None: 0,
  Ack: 1,
  Sync: 3,
  Data: 4,
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const NST = {
  Debug: 0,
  Datagram: 1,
} as const;
export type NST = (typeof NST)[keyof typeof NST];

export const OPCode = {
  ReadRequest: 2,
  SubscribeRequest: 3,
  ReportData: 5,
  WriteRequest: 6,
  InvokeRequest: 8,
} as const;
export type OPCode = (typeof OPCode)[keyof typeof OPCode];

export const AttributeId = {
  FirmwareVersion: 2,
  Voltages: 3,
  ClockMicros: 4,
  AllPatternNames: 5,
  CurrentPatternName: 6,
  IntensityPercent: 7,
  PlayPauseStop: 8,
  BoxName: 9,
  PtDescriptorQueue: 10,
  HeartbeatIntervalSecs: 11,
  BootloaderVersion: 12,
  FirmwareUpdate: 13,
} as const;
export type AttributeId = (typeof AttributeId)[keyof typeof AttributeId];

/** TLV-style payload encoding markers from NeoDK protocol. */
export const Encoding = {
  UnsignedInt1: 4,
  UTF8_1Len: 12,
  Bytes_1Len: 16,
  Array: 22,
  EndOfContainer: 24,
} as const;
export type Encoding = (typeof Encoding)[keyof typeof Encoding];

export const FRAME_HEADER_SIZE = 8;
export const PACKET_HEADER_SIZE = 6;
export const ATTRIBUTE_ACTION_SIZE = 6;
export const MAX_PAYLOAD_SIZE = 512;
