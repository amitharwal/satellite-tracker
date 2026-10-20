# SGP4 verification data

Reference data for the SGP4/SDP4 verification suite
(`src/orbit/sgp4.verification.test.ts`).

## Source

D. A. Vallado, P. Crawford, R. Hujsak, T. S. Kelso, "Revisiting Spacetrack Report #3",
AIAA 2006-6753. Companion code: <https://celestrak.org/publications/AIAA/2006-6753/>.

- Download: `AIAA-2006-6753.zip`, SHA-256
  `3642043b706c76be87cf012db3f22e04da6b80498d00f515e51879e0ffadc115` (fetched 2026-10-20).
- Reference implementation inside it: `sgp4/cpp/SGP4/SGP4/SGP4.cpp` (last change noted
  2020-03-12), SHA-256 `2ee7ad0e8f201e8251894083fe21e33a7aace2f43c871bf04357eb44a891b06e`.

License: the CelesTrak FAQ for this paper states there is no license associated with the
code and it may be used for any purpose, asking that the source be cited and linked. It is
cited here and in `src/orbit/sgp4.ts`.

## Files

| File                      | Origin                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `SGP4-VER.TLE`            | Verbatim from the zip (`sgp4/cpp/testsgp4/SGP4-VER.TLE`). 33 cases with start/stop/step.    |
| `published-cpp-e/*.e`     | Verbatim from the zip (`sgp4/cpp/testsgp4/TestSGP4/*.e`): the C++ verification ephemerides. |
| `reference-opsmode-a.txt` | Output of the reference C++ compiled locally with `harness/driver.cpp`, opsmode `a`.        |
| `reference-opsmode-i.txt` | Same, opsmode `i`.                                                                          |
| `harness/driver.cpp`      | The driver used to produce the two files above.                                             |

### Why there are generated reference files

The published `.e` files don't cover everything the suite needs:

- They don't record which opsmode produced them. Comparing against the locally compiled
  reference shows they were generated with **opsmode `a`**: max position difference
  3.8e-8 km over 641 points (print rounding). Opsmode `i` differs by up to 0.96 km.
- They don't record error codes. The driver prints them (`ERR <tsince> <code>` and the
  code after `SAT`).
- `20413` appears twice in `SGP4-VER.TLE`; its `.e` file holds only the second run.
- `33334` fails at initialisation (error 3), so its single `.e` row is stale state left over
  from the previous satellite. It is checked for its error code only.

The generated files therefore extend, and are cross-checked against, the published output.

### Regenerating

```sh
clang++ -std=c++17 -O0 -ffp-contract=off -w -I<zip>/sgp4/cpp/SGP4/SGP4 \
  harness/driver.cpp <zip>/sgp4/cpp/SGP4/SGP4/SGP4.cpp -o ref
./ref a SGP4-VER.TLE > reference-opsmode-a.txt
./ref i SGP4-VER.TLE > reference-opsmode-i.txt
```

Generated with Apple clang 21.0.0 on arm64. `-ffp-contract=off` disables fused multiply-add
so results match the classic x86 builds that produced the `.e` files.

Output format: `SAT <satnum> <error after init>`, then one line per step:
`<tsince min> <x y z km> <vx vy vz km/s> <error>`, or `ERR <tsince min> <code>` when
propagation stops.
