# GitHub Pages 실시간 공유 저장 설정

GitHub Pages는 HTML/CSS/JS 파일만 보여주는 정적 호스팅입니다.
그래서 GitHub에 `index.html`을 올리는 것만으로는 여러 기기가 같은 데이터를 저장하고 볼 수 없습니다.

이 프로젝트는 Firebase Realtime Database를 공용 저장소로 사용하도록 수정되어 있습니다.
Firebase가 실제로 연결되지 않으면 관리자 페이지는 저장을 거부합니다.
즉, 예전처럼 내 휴대폰에만 저장되는 상태로 넘어가지 않습니다.

## 정상 연결 확인

GitHub Pages에 접속했을 때 첫 화면이나 관리자/학생 화면에 아래 표시가 보여야 합니다.

- `Cloud connected`: 정상입니다. 여러 기기가 같은 데이터를 봅니다.
- `Cloud setup required`: `firebase-config.js`가 아직 실제 Firebase 값으로 설정되지 않았습니다.
- `Cloud error`: Firebase 설정, Rules, 네트워크, Database URL 중 하나에 문제가 있습니다.

## Firebase 설정 방법

1. Firebase 콘솔에서 프로젝트를 만듭니다.
2. Realtime Database를 생성합니다.
3. 웹 앱을 추가하고 Firebase config 값을 복사합니다.
4. `firebase-config.js`의 `YOUR_...` 값을 전부 실제 값으로 교체합니다.
5. 수정한 `firebase-config.js`까지 GitHub에 업로드합니다.

예시:

```js
window.RANKING_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...firebaseapp.com",
  databaseURL: "https://...-default-rtdb.firebaseio.com",
  projectId: "...",
  storageBucket: "...appspot.com",
  messagingSenderId: "...",
  appId: "..."
};

window.RANKING_REQUIRE_REMOTE_STORAGE = true;
window.RANKING_FIREBASE_PATH_PREFIX = "ranking-100";
```

## Realtime Database Rules

공유 테스트용 Rules:

```json
{
  "rules": {
    "ranking-100": {
      ".read": true,
      ".write": true
    }
  }
}
```

주의: 이 Rules는 링크를 아는 사람이 데이터를 읽고 쓸 수 있습니다.
관리자만 쓰게 하려면 Firebase Authentication과 별도 보안 규칙이 필요합니다.

## 휴대폰 테스트 순서

1. 휴대폰 A에서 GitHub Pages의 `index.html`을 엽니다.
2. `Cloud connected`가 보이는지 확인합니다.
3. 휴대폰 A에서 같은 그룹의 관리자 페이지로 들어가 데이터를 입력합니다.
4. 휴대폰 B에서 같은 그룹의 학생 페이지를 엽니다.
5. 두 휴대폰의 URL에 있는 `group=...` 값이 같아야 같은 데이터를 봅니다.

예:

- `admin.html?group=steam-l2-1`
- `student.html?group=steam-l2-1`

`steam-l2-1`과 `steam-l2-2`는 서로 다른 저장 공간입니다.
