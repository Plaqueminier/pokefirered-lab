#ifndef GUARD_LAB_H
#define GUARD_LAB_H

// Lab build only (make lab). See CONTEXT.md.
#if LAB
extern const volatile u16 gLabRngSeed;

void CB2_LabBoot(void);
#endif

#endif // GUARD_LAB_H
