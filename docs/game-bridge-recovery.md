# PR3 기반 게임 연결·outbox 복구 작업

기준은 원격 PR #3 `codex/rosalyn-ai-dialogue`의 `baa255906c3b3105d8cd1a14e28d206b32adb1de`다. 새 환경에서 `codex/game-bridge-recovery` 브랜치로 재구현했다. 이전 서버의 미푸시 `0d110c2`는 접근하거나 복구하지 않았다. 이전 볼륨, 기존 PR/main, 운영 private Site v2에는 변경을 적용하지 않았다.

## 실제 확인한 빈 부분과 구현

| PR3에서 확인한 상태                                           | 이번 변경                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 공개 연결 계약만 있고 재사용 가능한 클라이언트 없음           | `public/game-client.js`, `examples/game-host.js`: 연결, 재접속, 계정 초기화, 장착 복구 샘플                              |
| 클라이언트의 이전 계정 응답을 차단할 세대 경계 없음           | 동기 `disconnect()`, 모든 await 뒤 세대 검사, 응답 Promise도 이전 상태 대신 거부. 서버의 불투명 `scope` 응답/헤더를 비교 |
| 장착 재시도가 같은 이벤트를 재기록                            | 사용자별 요청 ID 영수증 + 조건부 상태 변경. 재시도는 옛 결과를 저장해 반환하지 않고 현재 권한/상태를 조회                |
| D1의 장착/권한 조회가 분리되어 환불과 엇갈릴 수 있음          | 단일 SQL 상태 조회, 원자적 권한 확인/장착/영수증 batch. 이미 저장된 서명 검증 환불 기록도 즉시 권한에서 제외             |
| Node outbox가 sink 반환값을 검사하지 않으며 Sites 전달기 없음 | Node/D1 공용 strict ACK, `sites/outbox.js`, 원자적 중복 방지 로컬 sink 샘플                                              |
| 초기 UI·선택지가 분석 조회 완료에 종속                        | 분석 조회를 비동기 진단 표시로 분리. 무응답/실패가 초기 화면·선택지·장착·퀘스트를 막지 않음                              |
| 선택적 게임 분석 기록 실패가 게임 요청을 실패시킴             | 선택적 관측 실패는 흡수. 결제 승인·권한 부여 감사 기록의 원자적 실패 처리는 유지                                         |

## 게임 호스트 연결 계약

`GET /api/session`의 `scope`와 각 성공 API 응답의 `X-Commerce-Scope`는 서버가 정한 불투명 계정 비교값이다. 인증 수단이 아니다. 클라이언트는 API 요청에 같은 값을 보낸다. 현재 서버 인증 계정과 다르면 서버는 상태 변경 전에 `409 account_changed`를 반환한다. 인증은 기존 host verifier 또는 Sites의 owner-only dispatch 경계가 계속 담당한다. 이전 호출자는 scope 헤더 생략이 가능하지만 새 클라이언트는 반드시 검사한다.

호스트는 **로그아웃/계정 전환을 시작하는 순간, 비동기 로그인 작업보다 먼저** `accountChanging()` 또는 `disconnect()`를 호출해야 한다. 이를 늦게 호출하면 클라이언트가 아직 일어나지 않은 호스트 전환을 예측할 수 없다. 예시:

```js
import { createWardrobeSample } from "./examples/game-host.js";
const wardrobe = createWardrobeSample({
  // 실제 게임의 동작을 복사하지 않은 콜백 경계. 구매 외 진행 상태는 유지한다.
  setCommerceAppearance: (view) => host.replaceCommerceAppearance(view),
});
await wardrobe.reconnect();
await wardrobe.equip("rosalyn-gala"); // 서버에서 소유 권한을 다시 확인

// 호스트에서 계정을 바꿀 때:
wardrobe.accountChanging(); // 이전 UI와 진행 중 결과를 즉시 무효화
await host.completeExistingLogin();
await wardrobe.reconnect();
```

장착 응답을 잃으면 `pendingEquip`은 같은 계정/요청 ID/상품을 유지한다. 연결 복구 실패에도 유지되며, 같은 계정으로 `reconnect()` 후 사용자가 명시적으로 `recoverEquip()`을 실행할 수 있다. 다른 계정에는 넘기지 않는다. 서버는 같은 ID를 다른 상품에 사용하면 409로 거부하며, 과거 장착을 재적용하지 않는다. 환불되거나 그 후 다른 옷을 입은 경우 현재 상태를 반환한다. 다른 요청 ID로 이미 입은 옷을 선택해도 장착 이벤트가 추가되지 않는다.

영수증은 `sites/migrations/0003_equip_requests.sql`에 추가한다. 기존 migration은 수정하지 않았다. Node 저장소에는 `equip_requests` 테이블만 추가한다. 영수증을 임의 삭제하면 과거 요청의 재생 방지 보장이 사라지므로 보존/정리 정책은 실제 호스트 통합 때 정해야 한다. 브라우저 새로고침은 서버 상태를 복원하지만 메모리의 미확정 intent는 사라진다. 실제 호스트에서 영속 intent가 필요하면 인증된 계정별 저장/복구 정책을 따로 설계해야 한다. localStorage의 소유권을 신뢰하지 않는다.

샘플은 상거래 소유의 외형과 SKU 목록만 콜백으로 제공한다. 기존 게임의 gold, seal, rumor, quest, save slot, earned/free look을 덮어쓰지 않는다. 실제 호스트의 퀘스트 판정/로그인/계정 복구 구현은 포함하지 않는다. 서버 스냅샷은 조회 시점의 상태이며 실시간 환불 push가 아니다. 재접속·장착·중요 판정 직전에 다시 읽고 서버 권한 검증을 사용해야 한다.

## Sites outbox 전달과 ACK

```js
import { deliverSitesOutbox } from "./sites/outbox.js";
// 승인된 신뢰 서버의 작업에서만 호출한다. 이 저장소는 작업을 등록하지 않는다.
await deliverSitesOutbox(DB, sink, 100);
```

`sink.accept(event)`는 이벤트 ID 중복 검사와 소비 효과를 하나의 영속 트랜잭션으로 커밋한 뒤 `{id: event.id, status: "accepted" | "duplicate"}`를 반환해야 한다. 누락/잘못된 ID/거부 상태의 ACK는 처리 완료로 기록하지 않는다. sink가 이벤트 인자를 바꿔 다른 ID를 ACK하도록 유도할 수도 없다. 성공 직후 응답 유실, source ACK 실패, 재시작, 동시 전달은 재전달될 수 있으며 sink의 영속 ID 영수증이 중복 효과를 막는다. 전달 자체는 at-least-once다.

`examples/outbox-sink.js`는 별도 로컬 SQLite에서 영수증과 카운트를 원자적으로 저장하는 독립 샘플이다. 같은 ID에 다른 데이터가 오면 거부한다. 외부 목적지·자격 증명·자동 스케줄러는 구성하지 않았다. HTTP로 원시 이벤트나 ACK를 노출하는 경로도 없다. 이벤트는 허용된 이름 및 `{id,user_id,order_id,name,at}`만 포함한다.

게임 진행 관측은 best-effort이므로 분석 DB 오류/커밋 후 프로세스 종료 때 관측이 누락될 수 있다. 누락된 관측을 성공 전달로 가장하지 않는다. 결제 권한 부여와 그 감사 이벤트는 기존 원자적 트랜잭션을 유지하며, 감사 기록 실패 시 권한 부여도 롤백된다.

## 검증과 경계

2026-10-17, Node 24 / 로컬 Chromium에서 검증한다:

- `npm run check`: 기존 236개 + 새 회귀 21개, 총 257개. 계정 전환/지연 응답/잘못된 scope, 환불·장착 경합, 중복/응답 유실/재접속 실패, SQL 롤백, 분석 기록 장애, 잘못된 ACK, 동시 전달/재시작/소비 효과 중복 방지, 추가 migration의 기존 스키마/행 보존, 소스 전달물 포함 여부.
- `BROWSER_TEST_PORT=3300 node scripts/browser-smoke.js`: 실제 Chromium과 로컬 HTTP, SQLite D1 계약 fixture. 분석 무응답·503 중 초기 UI와 선택지, 장착 커밋 후 502와 복구 버튼, 하나의 영수증/장착 이벤트, 분석 기록 장애 중 무료 퀘스트, 동기 계정 초기화, 기존 결제 모의/재시작/모바일 390px·200%/키보드/한영 안내 테스트.
- 스크린샷: [분석 API 장애 중 선택지](screenshots/mock-sites-analytics-outage-choices.png), [계정 전환 후 초기화](screenshots/mock-sites-account-reset.png). 모두 로컬 모의 화면이다.
- 결제·AI provider 경로는 메모리 모의 구현 또는 fake HTTP 응답만 사용한다. 실제 PayPal/OpenAI 전송, 호스팅 검증, 실결제·실게임 연동 결과가 아니다.
- OneSub 코드와 MIT 고지/라이선스는 변경하지 않았다. WonderLupin 비공개 코드/자료 및 mimi-seed-sdk PolyForm 코드를 읽거나 복제하지 않았다.

## 남은 실제 연동 조건

1. 실제 게임 저장소에서 승인된 host adapter 구현: 기존 인증을 매 요청 검증, 복구 가능한 구매 계정 정책, 동기 계정 전환 알림, 기존 게임 상태를 보존하는 외형 통합.
2. 승인된 별도 단계에서 private Site v2 소스/정식 빌드·D1 migration 적용 및 실제 dispatch/owner/CSRF 검증. 이번 작업은 저장소 소스와 로컬 커밋까지만이다.
3. 실제 이벤트 목적지의 접근 범위/보존 정책·원자적 중복 방지·운영 작업 등록. SDK 복제나 공개 ACK 엔드포인트로 대체하지 않는다.
4. 별도 승인된 Sandbox 환경/콜백 접근/merchant·app 구성으로 실제 승인→capture→검증 webhook→권한 부여→환불 회귀 실행. owner-private Site는 익명 PayPal callback 전달을 검증한 상태가 아니다. 자격 증명 조회·생성·변경이나 공개 전환은 이번 범위에 없다.

push/merge/deploy, 운영 Site 변경, 유료 API 실행은 수행하지 않았다.
