// Local harness: runs Vallado's reference SGP4 over SGP4-VER.TLE exactly like
// TestSGP4.cpp's verification loop, printing full precision and error codes.
#include <cstdio>
#include <cstring>
#include <cmath>
#include "SGP4.h"
int main(int argc, char** argv) {
  char opsmode = argv[1][0];
  FILE* in = fopen(argv[2], "r");
  char l1[130], l2[130];
  double ro[3], vo[3], startmfe, stopmfe, deltamin;
  while (fgets(l1, 130, in)) {
    if (l1[0] == '#') continue;
    if (!fgets(l2, 130, in)) break;
    elsetrec satrec;
    memset(&satrec, 0, sizeof satrec);
    satrec.classification = 'U';
    SGP4Funcs::twoline2rv(l1, l2, 'v', 'e', opsmode, wgs72, startmfe, stopmfe, deltamin, satrec);
    printf("SAT %s %d\n", satrec.satnum, satrec.error);
    SGP4Funcs::sgp4(satrec, 0.0, ro, vo);
    printf("%.10f %.12f %.12f %.12f %.14f %.14f %.14f %d\n", 0.0, ro[0], ro[1], ro[2], vo[0], vo[1], vo[2], satrec.error);
    double t = startmfe;
    if (fabs(t) > 1e-8) t -= deltamin;
    while (t < stopmfe && satrec.error == 0) {
      t += deltamin;
      if (t > stopmfe) t = stopmfe;
      SGP4Funcs::sgp4(satrec, t, ro, vo);
      if (satrec.error > 0) printf("ERR %.10f %d\n", t, satrec.error);
      else printf("%.10f %.12f %.12f %.12f %.14f %.14f %.14f 0\n", t, ro[0], ro[1], ro[2], vo[0], vo[1], vo[2]);
    }
  }
}
