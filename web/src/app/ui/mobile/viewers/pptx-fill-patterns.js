/*!
 * Copyright (C) 2007 Google (Evan Stade)
 * Copyright (C) 2003-2004,2007 Novell, Inc. http://www.novell.com (Ravindra (rkumar@novell.com))
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA 02110-1301, USA
 */


// Mathematical 8x8 HatchStyle masks mapped by ISO/IEC 29500-1 20.1.10.50.
// Reference bitmap data: Wine gdiplus brush.c blob 19722629e3d522a21fb6d6aaa45716ced1a6d9d1.
// Pixel equivalence with PowerPoint remains independently unverified.
export const DRAWINGML_PATTERN_ROWS = Object.freeze({
  "horz": [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    255
  ],
  "vert": [
    128,
    128,
    128,
    128,
    128,
    128,
    128,
    128
  ],
  "dnDiag": [
    1,
    2,
    4,
    8,
    16,
    32,
    64,
    128
  ],
  "upDiag": [
    128,
    64,
    32,
    16,
    8,
    4,
    2,
    1
  ],
  "cross": [
    128,
    128,
    128,
    128,
    128,
    128,
    128,
    255
  ],
  "lgGrid": [
    128,
    128,
    128,
    128,
    128,
    128,
    128,
    255
  ],
  "diagCross": [
    129,
    66,
    36,
    24,
    24,
    36,
    66,
    129
  ],
  "ltDnDiag": [
    17,
    34,
    68,
    136,
    17,
    34,
    68,
    136
  ],
  "ltUpDiag": [
    136,
    68,
    34,
    17,
    136,
    68,
    34,
    17
  ],
  "dkDnDiag": [
    153,
    51,
    102,
    204,
    153,
    51,
    102,
    204
  ],
  "dkUpDiag": [
    153,
    204,
    102,
    51,
    153,
    204,
    102,
    51
  ],
  "wdDnDiag": [
    131,
    7,
    14,
    28,
    56,
    112,
    224,
    193
  ],
  "wdUpDiag": [
    193,
    224,
    112,
    56,
    28,
    14,
    7,
    131
  ],
  "ltVert": [
    136,
    136,
    136,
    136,
    136,
    136,
    136,
    136
  ],
  "ltHorz": [
    0,
    0,
    0,
    255,
    0,
    0,
    0,
    255
  ],
  "narVert": [
    85,
    85,
    85,
    85,
    85,
    85,
    85,
    85
  ],
  "narHorz": [
    0,
    255,
    0,
    255,
    0,
    255,
    0,
    255
  ],
  "dkVert": [
    204,
    204,
    204,
    204,
    204,
    204,
    204,
    204
  ],
  "dkHorz": [
    0,
    0,
    255,
    255,
    0,
    0,
    255,
    255
  ],
  "dashDnDiag": [
    0,
    0,
    17,
    34,
    68,
    136,
    0,
    0
  ],
  "dashUpDiag": [
    0,
    0,
    136,
    68,
    34,
    17,
    0,
    0
  ],
  "dashHorz": [
    0,
    0,
    0,
    15,
    0,
    0,
    0,
    240
  ],
  "dashVert": [
    8,
    8,
    8,
    8,
    128,
    128,
    128,
    128
  ],
  "smConfetti": [
    4,
    32,
    1,
    16,
    2,
    64,
    8,
    128
  ],
  "lgConfetti": [
    141,
    12,
    192,
    216,
    27,
    3,
    48,
    177
  ],
  "zigZag": [
    24,
    36,
    66,
    129,
    24,
    36,
    66,
    129
  ],
  "wave": [
    192,
    37,
    24,
    0,
    192,
    37,
    24,
    0
  ],
  "diagBrick": [
    129,
    66,
    36,
    24,
    8,
    4,
    2,
    1
  ],
  "horzBrick": [
    8,
    8,
    8,
    255,
    128,
    128,
    128,
    255
  ],
  "weave": [
    81,
    34,
    20,
    136,
    69,
    34,
    84,
    136
  ],
  "plaid": [
    240,
    240,
    240,
    240,
    85,
    170,
    85,
    170
  ],
  "divot": [
    128,
    1,
    128,
    0,
    16,
    8,
    16,
    0
  ],
  "dotGrid": [
    0,
    128,
    0,
    128,
    0,
    128,
    0,
    170
  ],
  "dotDmnd": [
    0,
    34,
    0,
    8,
    0,
    34,
    0,
    128
  ],
  "shingle": [
    1,
    1,
    2,
    12,
    48,
    72,
    132,
    3
  ],
  "trellis": [
    153,
    255,
    102,
    255,
    153,
    255,
    102,
    255
  ],
  "sphere": [
    248,
    248,
    152,
    119,
    143,
    143,
    137,
    119
  ],
  "smGrid": [
    136,
    136,
    136,
    255,
    136,
    136,
    136,
    255
  ],
  "smCheck": [
    153,
    102,
    102,
    153,
    153,
    102,
    102,
    153
  ],
  "lgCheck": [
    15,
    15,
    15,
    15,
    240,
    240,
    240,
    240
  ],
  "openDmnd": [
    1,
    130,
    68,
    40,
    16,
    40,
    68,
    130
  ],
  "solidDmnd": [
    0,
    16,
    56,
    124,
    254,
    124,
    56,
    16
  ],
  "pct5": [
    0,
    0,
    0,
    8,
    0,
    0,
    0,
    128
  ],
  "pct10": [
    0,
    8,
    0,
    128,
    0,
    8,
    0,
    128
  ],
  "pct20": [
    0,
    34,
    0,
    136,
    0,
    34,
    0,
    136
  ],
  "pct25": [
    34,
    136,
    34,
    136,
    34,
    136,
    34,
    136
  ],
  "pct30": [
    17,
    170,
    68,
    170,
    17,
    170,
    68,
    170
  ],
  "pct40": [
    21,
    170,
    85,
    170,
    81,
    170,
    85,
    170
  ],
  "pct50": [
    85,
    170,
    85,
    170,
    85,
    170,
    85,
    170
  ],
  "pct60": [
    85,
    187,
    85,
    238,
    85,
    187,
    85,
    238
  ],
  "pct70": [
    221,
    119,
    221,
    119,
    221,
    119,
    221,
    119
  ],
  "pct75": [
    255,
    221,
    255,
    119,
    255,
    221,
    255,
    119
  ],
  "pct80": [
    255,
    254,
    255,
    239,
    255,
    254,
    255,
    239
  ],
  "pct90": [
    127,
    255,
    255,
    255,
    247,
    255,
    255,
    255
  ]
});
