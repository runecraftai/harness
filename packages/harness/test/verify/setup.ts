// verify/setup.ts — preload da suite de verificação (F25 T12, padrão F21 D3 / F24 T7).
//
// O preload global (test/eval/setup.ts) já isola HOME/XDG/GIT_CONFIG_* antes
// do primeiro import; este preload reafirma as invariantes da cascata:
//   - RUNECRAFT_VERIFY nunca ativo por acidente (kill switch off por padrão)
//   - RUNECRAFT_VERIFY_LLM_JUDGE nunca ativo (o judge NUNCA roda em CI — env
//     off por construção; os testes de judge setam/restauram por teste)
if (process.env.RUNECRAFT_VERIFY === undefined) process.env.RUNECRAFT_VERIFY = "";
if (process.env.RUNECRAFT_VERIFY_LLM_JUDGE === undefined) process.env.RUNECRAFT_VERIFY_LLM_JUDGE = "";
if (!process.env.GIT_CONFIG_GLOBAL) process.env.GIT_CONFIG_GLOBAL = "/dev/null";
if (!process.env.GIT_CONFIG_SYSTEM) process.env.GIT_CONFIG_SYSTEM = "/dev/null";
