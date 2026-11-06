# expo/types: react-native-web.d.ts props reject `undefined` under `exactOptionalPropertyTypes`

`npx create-expo-app@latest` (SDK 58, npm) reduced to one screen, [`src/app/index.tsx`](src/app/index.tsx), with `"exactOptionalPropertyTypes": true` added to [`tsconfig.json`](tsconfig.json). `skipLibCheck` stays `true` from `expo/tsconfig.base`.

1. `npm install`
2. `npx expo customize tsconfig.json`. It writes `expo-env.d.ts` (`/// <reference types="expo/types" />`), as `npx expo start` does when typed routes are on.
3. `npx tsc --noEmit`

Expected: no error. Seen: an error on each line of `src/app/index.tsx` that passes an optional prop on to `className`, `lang` or a web style member that `expo/types/react-native-web.d.ts` declares:

```
src/app/index.tsx(21,8): error TS2375: Type '{ className: string | undefined; }' is not assignable to type 'Omit<ViewProps, "ref">' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
```

`node repro.mjs` runs the three steps against `packages/expo/types/react-native-web.d.ts` on expo's `main`, prints each step, and exits 1 while a case fails, 0 when none does, and 2 when a step fails or `tsc` reports another error. `node repro.mjs --overlay <path>` runs them against another copy of that file.
