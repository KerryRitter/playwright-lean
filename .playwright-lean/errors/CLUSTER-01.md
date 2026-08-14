# Failure Dossier: CLUSTER-01

**Category**: `ASSERTION_FAILURE`  
**Root Stack Frame**: `billing.spec.ts:50`  
**Affected Tests**: 1 test(s) across 1 file(s)

---

## 💥 Normalized Error Signature
```text
Error: expect(received).toBe(expected)
Expected: 200
Received: 400
```

---

## 📍 Primary Failing Code
*(No source snippet available)*

---

## 📁 Affected Test Files
- `billing.spec.ts` (charge customer card)

---

## 🛠️ Verification Command
```bash
playwright-lean verify CLUSTER-01
```
