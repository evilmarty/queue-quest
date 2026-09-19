#!/usr/bin/env python3

import math
import random
import wave
from array import array
from pathlib import Path

SAMPLE_RATE = 22_050
TEMPO = 108
BEAT = 60 / TEMPO
BARS = 20
DURATION = BARS * 4 * BEAT
FRAME_COUNT = int(DURATION * SAMPLE_RATE)
OUTPUT = Path(__file__).parents[1] / "src/assets/epic-adventure.wav"
LOOP_OUTPUT = (
    Path(__file__).parents[1] / "src/assets/epic-adventure-loop.wav"
)
VICTORY_OUTPUT = (
    Path(__file__).parents[1] / "src/assets/victory-fanfare.wav"
)

left = array("f", [0.0]) * FRAME_COUNT
right = array("f", [0.0]) * FRAME_COUNT
random.seed(13)


def add_sample(frame, sample, pan=0.0):
    if frame < 0 or frame >= FRAME_COUNT:
        return
    left[frame] += sample * math.sqrt((1 - pan) / 2)
    right[frame] += sample * math.sqrt((1 + pan) / 2)


def shaped_envelope(position, duration, attack, release, sustain=1.0):
    if position < attack:
        return (position / attack) ** 0.7
    if position > duration - release:
        return sustain * max(0.0, (duration - position) / release) ** 1.4
    return sustain


def add_voice(
    start,
    duration,
    frequency,
    volume,
    harmonics,
    pan=0.0,
    attack=0.025,
    release=0.16,
    vibrato=0.002,
):
    start_frame = max(0, math.ceil(start * SAMPLE_RATE))
    end_frame = min(FRAME_COUNT, int((start + duration) * SAMPLE_RATE))

    for frame in range(start_frame, end_frame):
        position = max(0.0, frame / SAMPLE_RATE - start)
        env = shaped_envelope(position, duration, attack, release)
        pitch = frequency * (
            1 + vibrato * math.sin(2 * math.pi * 5.1 * position)
        )
        sample = sum(
            strength * math.sin(2 * math.pi * pitch * multiple * position)
            for multiple, strength in harmonics
        )
        add_sample(frame, sample * volume * env, pan)


def add_taiko(start, volume=1.0, pitch=54, pan=0.0):
    duration = 0.92
    start_frame = int(start * SAMPLE_RATE)
    end_frame = min(FRAME_COUNT, int((start + duration) * SAMPLE_RATE))
    phase = 0.0

    for frame in range(start_frame, end_frame):
        position = max(0.0, frame / SAMPLE_RATE - start)
        frequency = pitch + 150 * math.exp(-position * 24)
        phase += 2 * math.pi * frequency / SAMPLE_RATE
        body = (
            math.sin(phase)
            + 0.4 * math.sin(phase * 1.51)
            + 0.18 * math.sin(phase * 2.03)
        ) * math.exp(-position * 4.1)
        strike = (random.random() * 2 - 1) * math.exp(-position * 42)
        add_sample(frame, volume * (body * 0.78 + strike * 0.38), pan)


def add_snare(start, volume=1.0):
    duration = 0.32
    start_frame = int(start * SAMPLE_RATE)
    end_frame = min(FRAME_COUNT, int((start + duration) * SAMPLE_RATE))
    previous = 0.0

    for frame in range(start_frame, end_frame):
        position = max(0.0, frame / SAMPLE_RATE - start)
        noise = random.random() * 2 - 1
        bright_noise = noise - previous * 0.74
        previous = noise
        tone = math.sin(2 * math.pi * 185 * position)
        env = math.exp(-position * 16)
        add_sample(frame, volume * env * (bright_noise * 0.78 + tone * 0.22))


def add_cymbal(start, volume=1.0, duration=2.5):
    start_frame = int(start * SAMPLE_RATE)
    end_frame = min(FRAME_COUNT, int((start + duration) * SAMPLE_RATE))
    previous = 0.0

    for frame in range(start_frame, end_frame):
        position = max(0.0, frame / SAMPLE_RATE - start)
        noise = random.random() * 2 - 1
        bright_noise = noise - previous * 0.965
        previous = noise
        metallic = sum(
            math.sin(2 * math.pi * frequency * position)
            for frequency in (2_713, 3_947, 5_219, 7_123)
        ) / 4
        env = math.exp(-position * 1.75)
        sample = volume * env * (bright_noise * 0.82 + metallic * 0.24)
        add_sample(frame, sample, 0.16)


def add_riser(start, duration, volume=1.0):
    start_frame = int(start * SAMPLE_RATE)
    end_frame = min(FRAME_COUNT, int((start + duration) * SAMPLE_RATE))
    previous = 0.0

    for frame in range(start_frame, end_frame):
        position = max(0.0, frame / SAMPLE_RATE - start)
        progress = position / duration
        noise = random.random() * 2 - 1
        bright_noise = noise - previous * (0.75 + progress * 0.22)
        previous = noise
        pulse = 0.65 + 0.35 * math.sin(
            2 * math.pi * (2 + progress * 10) * position
        )
        env = progress**2.2
        add_sample(frame, bright_noise * pulse * env * volume, -0.1 + progress * 0.2)


def add_braam(start, root, volume=1.0):
    for frequency, strength, pan in (
        (root / 2, 0.44, 0.0),
        (root, 0.28, -0.14),
        (root * 1.5, 0.2, 0.14),
    ):
        add_voice(
            start,
            2.8,
            frequency,
            volume * strength,
            ((1, 1), (2, 0.62), (3, 0.35), (4, 0.2), (5, 0.1)),
            pan,
            attack=0.08,
            release=1.15,
            vibrato=0.0008,
        )


CHORDS = [
    (110.00, 164.81, 220.00),   # Am
    (87.31, 130.81, 174.61),    # F
    (130.81, 196.00, 261.63),   # C
    (98.00, 146.83, 196.00),    # G
    (110.00, 164.81, 220.00),
    (146.83, 220.00, 293.66),   # Dm
    (87.31, 130.81, 174.61),
    (98.00, 146.83, 196.00),
]

HERO_THEME = [
    440.00, None, 440.00, 523.25, 659.25, None, 587.33, 523.25,
    440.00, None, 523.25, 659.25, 783.99, None, 739.99, 659.25,
    587.33, None, 659.25, 739.99, 880.00, None, 783.99, 739.99,
    659.25, 739.99, 783.99, 987.77, 880.00, 783.99, 739.99, 659.25,
]

OSTINATO = (0, 2, 1, 2, 0, 2, 1, 2)

for bar in range(BARS):
    bar_start = bar * 4 * BEAT
    chord = CHORDS[bar % len(CHORDS)]
    section = bar // 4
    intensity = (0.58, 0.76, 0.94, 1.12, 1.28)[section]
    # Low strings, brass bed, and choir-like open vowels.
    add_voice(
        bar_start,
        4 * BEAT,
        chord[0] / 2,
        0.24 * intensity,
        ((1, 1), (2, 0.5), (3, 0.26), (4, 0.14)),
        -0.08,
        attack=0.09,
        release=0.38,
        vibrato=0.001,
    )
    for index, note in enumerate(chord):
        add_voice(
            bar_start,
            4 * BEAT,
            note,
            0.11 * intensity,
            ((1, 1), (2, 0.42), (3, 0.24), (5, 0.1)),
            -0.5 + index * 0.5,
            attack=0.16,
            release=0.42,
        )
        add_voice(
            bar_start,
            4 * BEAT,
            note * 2,
            0.045 * intensity,
            ((1, 1), (2, 0.2), (3, 0.08)),
            0.45 - index * 0.45,
            attack=0.38,
            release=0.55,
            vibrato=0.004,
        )

    # Driving string ostinato grows through each section.
    if bar >= 2:
        for eighth in range(8):
            note = chord[OSTINATO[eighth]]
            add_voice(
                bar_start + eighth * BEAT / 2,
                BEAT * 0.38,
                note * 2,
                0.075 * intensity,
                ((1, 1), (2, 0.36), (3, 0.18)),
                -0.24 if eighth % 2 == 0 else 0.24,
                attack=0.008,
                release=0.1,
                vibrato=0.001,
            )

    # Taiko ensemble: sparse opening, relentless final act.
    drum_steps = (0, 4) if bar < 2 else (0, 2, 4, 6)
    if bar >= 8:
        drum_steps = (0, 2, 3, 4, 6, 7)

    for step in drum_steps:
        hit_time = bar_start + step * BEAT / 2
        accent = 1.2 if step in (0, 4) else 0.76
        add_taiko(hit_time, 0.68 * intensity * accent, 48, -0.22)
        add_taiko(hit_time + 0.018, 0.46 * intensity * accent, 72, 0.25)

    if bar >= 4:
        for beat_index in (1, 3):
            add_snare(bar_start + beat_index * BEAT, 0.3 * intensity)

    # Heroic horn theme enters, then doubles in octaves for the climax.
    if bar >= 2:
        for half_beat in range(8):
            note = HERO_THEME[(bar * 2 + half_beat) % len(HERO_THEME)]
            if note is None:
                continue
            note_start = bar_start + half_beat * BEAT / 2
            duration = BEAT * (0.95 if half_beat % 4 == 0 else 0.43)
            add_voice(
                note_start,
                duration,
                note,
                0.16 * intensity,
                ((1, 1), (2, 0.68), (3, 0.42), (4, 0.22), (5, 0.13)),
                -0.08,
                attack=0.035,
                release=0.16,
                vibrato=0.0015,
            )
            if bar >= 12:
                add_voice(
                    note_start,
                    duration,
                    note / 2,
                    0.13 * intensity,
                    ((1, 1), (2, 0.58), (3, 0.3), (4, 0.14)),
                    0.14,
                    attack=0.04,
                    release=0.18,
                    vibrato=0.001,
                )

    if bar in (0, 4, 8, 12, 16):
        add_cymbal(bar_start, 0.52 * intensity)
        add_braam(bar_start, chord[0], 0.72 * intensity)

    if bar in (3, 7, 11, 15):
        add_riser(bar_start, 4 * BEAT, 0.16 * intensity)

# Final impact and tail, designed to resolve into the opening A minor chord.
final_start = (BARS - 1) * 4 * BEAT + 3 * BEAT
add_taiko(final_start, 1.35, 42)
add_taiko(final_start + 0.025, 0.9, 68, 0.22)
add_cymbal(final_start, 0.68, 1.2)
add_braam(final_start, 110, 1.0)

# Short stereo ambience taps add scale without washing out the drum transients.
for delay_seconds, gain, side in (
    (0.17, 0.14, "right"),
    (0.29, 0.1, "left"),
    (0.43, 0.065, "right"),
):
    delay_frames = int(delay_seconds * SAMPLE_RATE)
    source = array("f", left if side == "right" else right)
    target = right if side == "right" else left
    for frame in range(delay_frames, FRAME_COUNT):
        target[frame] += source[frame - delay_frames] * gain

def master_and_write(output, label):
    peak = max(
        max(abs(sample) for sample in left),
        max(abs(sample) for sample in right),
    )
    drive = 1.85 / peak
    shaped_left = array("f", (math.tanh(sample * drive) for sample in left))
    shaped_right = array("f", (math.tanh(sample * drive) for sample in right))
    shaped_peak = max(
        max(abs(sample) for sample in shaped_left),
        max(abs(sample) for sample in shaped_right),
    )
    master_gain = 0.975 / shaped_peak
    pcm = array("h")

    for left_sample, right_sample in zip(shaped_left, shaped_right):
        pcm.append(int(max(-1, min(1, left_sample * master_gain)) * 32767))
        pcm.append(int(max(-1, min(1, right_sample * master_gain)) * 32767))

    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as output_file:
        output_file.setnchannels(2)
        output_file.setsampwidth(2)
        output_file.setframerate(SAMPLE_RATE)
        output_file.writeframes(pcm.tobytes())

    print(f"Wrote {output} ({DURATION:.1f}s, {label} at 0.975 peak)")


master_and_write(OUTPUT, "cinematic intro master")

# Continue at full ensemble strength with a self-contained eight-bar cycle.
BARS = 8
DURATION = BARS * 4 * BEAT
FRAME_COUNT = int(DURATION * SAMPLE_RATE)
left = array("f", [0.0]) * FRAME_COUNT
right = array("f", [0.0]) * FRAME_COUNT
random.seed(29)

LOOP_CHORDS = (
    CHORDS[0],
    CHORDS[1],
    CHORDS[2],
    CHORDS[3],
    CHORDS[0],
    CHORDS[5],
    CHORDS[1],
    CHORDS[3],
)

for bar, chord in enumerate(LOOP_CHORDS):
    bar_start = bar * 4 * BEAT
    intensity = 1.08 + 0.08 * math.sin(bar * math.pi / 4)

    add_voice(
        bar_start,
        4 * BEAT,
        chord[0] / 2,
        0.23 * intensity,
        ((1, 1), (2, 0.5), (3, 0.26), (4, 0.14)),
        -0.08,
        attack=0.09,
        release=0.28,
        vibrato=0.001,
    )

    for index, note in enumerate(chord):
        add_voice(
            bar_start,
            4 * BEAT,
            note,
            0.1 * intensity,
            ((1, 1), (2, 0.42), (3, 0.24), (5, 0.1)),
            -0.5 + index * 0.5,
            attack=0.14,
            release=0.34,
        )
        add_voice(
            bar_start,
            4 * BEAT,
            note * 2,
            0.04 * intensity,
            ((1, 1), (2, 0.2), (3, 0.08)),
            0.45 - index * 0.45,
            attack=0.3,
            release=0.4,
            vibrato=0.004,
        )

    for eighth in range(8):
        note = chord[OSTINATO[eighth]]
        note_start = bar_start + eighth * BEAT / 2
        add_voice(
            note_start,
            BEAT * 0.38,
            note * 2,
            0.076 * intensity,
            ((1, 1), (2, 0.36), (3, 0.18)),
            -0.24 if eighth % 2 == 0 else 0.24,
            attack=0.008,
            release=0.1,
            vibrato=0.001,
        )

        melody_note = HERO_THEME[(bar * 4 + eighth) % len(HERO_THEME)]
        if melody_note is not None:
            add_voice(
                note_start,
                BEAT * (0.88 if eighth % 4 == 0 else 0.42),
                melody_note,
                0.145 * intensity,
                ((1, 1), (2, 0.68), (3, 0.42), (4, 0.22), (5, 0.13)),
                -0.08,
                attack=0.035,
                release=0.15,
                vibrato=0.0015,
            )

    for step in (0, 2, 3, 4, 6, 7):
        hit_time = bar_start + step * BEAT / 2
        accent = 1.16 if step in (0, 4) else 0.74
        add_taiko(hit_time, 0.64 * intensity * accent, 48, -0.22)
        add_taiko(hit_time + 0.018, 0.43 * intensity * accent, 72, 0.25)

    for beat_index in (1, 3):
        add_snare(bar_start + beat_index * BEAT, 0.29 * intensity)

    if bar in (0, 4):
        add_cymbal(bar_start, 0.46 * intensity)
        add_braam(bar_start, chord[0], 0.62 * intensity)

for delay_seconds, gain, side in (
    (0.17, 0.14, "right"),
    (0.29, 0.1, "left"),
    (0.43, 0.065, "right"),
):
    delay_frames = int(delay_seconds * SAMPLE_RATE)
    source = array("f", left if side == "right" else right)
    target = right if side == "right" else left
    for frame in range(delay_frames, FRAME_COUNT):
        target[frame] += source[frame - delay_frames] * gain

master_and_write(LOOP_OUTPUT, "continuation loop")

# A concise four-bar victory cue using the same ensemble and production style.
BARS = 4
VICTORY_TAIL_BEATS = 2
DURATION = (BARS * 4 + VICTORY_TAIL_BEATS) * BEAT
FRAME_COUNT = int(DURATION * SAMPLE_RATE)
left = array("f", [0.0]) * FRAME_COUNT
right = array("f", [0.0]) * FRAME_COUNT
random.seed(41)

VICTORY_CHORDS = (
    (130.81, 196.00, 261.63),   # C
    (174.61, 261.63, 349.23),   # F
    (196.00, 293.66, 392.00),   # G
    (130.81, 196.00, 261.63),   # C
)
VICTORY_THEME = (
    523.25, 659.25, 783.99, 1046.50,
    880.00, 783.99, 659.25, 783.99,
    880.00, 987.77, 1046.50, 1174.66,
    1046.50, 783.99, 659.25, 523.25,
)

for bar, chord in enumerate(VICTORY_CHORDS):
    bar_start = bar * 4 * BEAT
    intensity = 1 + bar * 0.1

    add_voice(
        bar_start,
        4 * BEAT,
        chord[0] / 2,
        0.23 * intensity,
        ((1, 1), (2, 0.5), (3, 0.24), (4, 0.12)),
        -0.08,
        attack=0.045,
        release=0.42,
        vibrato=0.001,
    )

    for index, note in enumerate(chord):
        add_voice(
            bar_start,
            4 * BEAT,
            note,
            0.12 * intensity,
            ((1, 1), (2, 0.5), (3, 0.28), (4, 0.12)),
            -0.5 + index * 0.5,
            attack=0.07,
            release=0.5,
            vibrato=0.002,
        )

    for beat_index in range(4):
        note_start = bar_start + beat_index * BEAT
        note = VICTORY_THEME[bar * 4 + beat_index]
        add_voice(
            note_start,
            BEAT * (1.75 if bar == 3 and beat_index == 0 else 0.82),
            note,
            0.2 * intensity,
            ((1, 1), (2, 0.72), (3, 0.44), (4, 0.24), (5, 0.12)),
            -0.08,
            attack=0.025,
            release=0.24,
            vibrato=0.0015,
        )
        add_voice(
            note_start,
            BEAT * 0.78,
            note / 2,
            0.12 * intensity,
            ((1, 1), (2, 0.58), (3, 0.3)),
            0.12,
            attack=0.025,
            release=0.2,
            vibrato=0.001,
        )

    for step in (0, 2, 4, 6):
        hit_time = bar_start + step * BEAT / 2
        add_taiko(hit_time, 0.72 * intensity, 52, -0.22)
        add_taiko(hit_time + 0.018, 0.48 * intensity, 78, 0.25)

    add_cymbal(bar_start, 0.48 * intensity, 1.5)

final_chord_start = 3 * 4 * BEAT
add_braam(final_chord_start, 130.81, 0.86)
add_cymbal(final_chord_start, 0.65, 3.2)

for delay_seconds, gain, side in (
    (0.17, 0.15, "right"),
    (0.29, 0.1, "left"),
    (0.43, 0.07, "right"),
):
    delay_frames = int(delay_seconds * SAMPLE_RATE)
    source = array("f", left if side == "right" else right)
    target = right if side == "right" else left
    for frame in range(delay_frames, FRAME_COUNT):
        target[frame] += source[frame - delay_frames] * gain

master_and_write(VICTORY_OUTPUT, "victory fanfare")
