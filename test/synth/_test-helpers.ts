/**
 * Test-helpers för synth-engine-tester.
 *
 * Sedan AMP-knob blev VCA-style (mute-utan-cable) behöver tester som
 * verifierar engine-emit-flödet patcha en "static AMP-source" — en LFO
 * med amount=0 + volume=1 ger konstant DC vid cap, som om AMP-base var
 * fader-värdet utan modulering.
 */
import { addCable, addLfo, setLfoAmount, setLfoVolume } from '../../src/synth/state';
import type { MixerState } from '../../src/synth/types';

/**
 * Patcha en static DC-LFO till channel.amplitude så engine emit:ar signal.
 * Skapar ny LFO med amount=0 (no swing) och volume=1 (centrumlinje vid cap)
 * → konstant cap-output. Ekvivalent med pre-VCA-modellens "AMP base = N
 * utan modulering".
 *
 * @param ampBase Vald cap-nivå (default 128 = matchar pre-VCA addChannel default).
 *   Sätt till 0 för "muted via cap" (cap=0 → output=0 även med LFO).
 *
 * Returnerar nytt state. Skapad LFO är sista i state.lfos.
 */
export function seedDcAmp(
  state: MixerState,
  channelId: string,
  ampBase: number = 128,
): MixerState {
  state = addLfo(state, 'sine');
  const lfoId = state.lfos[state.lfos.length - 1]!.id;
  state = setLfoAmount(state, lfoId, 0);
  state = setLfoVolume(state, lfoId, 1);
  state = addCable(state, lfoId, channelId, 'amplitude', 1.0);
  // Sätt amp.base = ampBase (cap) — bevarar modCableId från addCable
  state = {
    ...state,
    channels: state.channels.map((ch) =>
      ch.id !== channelId
        ? ch
        : {
            ...ch,
            knobs: {
              ...ch.knobs,
              amplitude: { ...ch.knobs.amplitude, base: ampBase },
            },
          },
    ),
  };
  return state;
}
