# SPIKE Prime BLE Motor Controller

`tkinter`와 `bleak`를 사용해 LEGO SPIKE Prime 허브를 블루투스로 검색하고 연결한 뒤, 선택한 포트의 모터를 회전시키는 예제입니다.

이 버전은 다음 두 가지 허브 상태를 모두 고려합니다.

- 공식 LEGO SPIKE 펌웨어: `FD02` UART 서비스 사용
- Pybricks 펌웨어: `Pybricks GATT Service` (`c5f50001-...`) 사용

## 설치

```bash
pip install -r requirements.txt
```

또는 개별 설치:

```bash
pip install bleak
```

`tkinter`는 일반적인 Python 설치에 기본 포함됩니다.

## 실행

```bash
python spike_prime_gui.py
```

## 사용 순서

1. 허브 전원을 켜고 블루투스가 활성화된 상태인지 확인합니다.
2. 프로그램에서 `스캔` 버튼을 눌러 SPIKE Prime 허브를 검색합니다.
3. 목록에서 허브를 선택하고 `연결`을 누릅니다.
4. 모터가 연결된 포트(A~F), 속도, 회전 각도를 입력합니다.
5. `모터 구동` 버튼을 눌러 허브 내부 REPL로 Python 코드를 전송합니다.

## 참고

- 공식 SPIKE 펌웨어는 `FD02` UART 서비스와 raw REPL 스타일을 사용합니다.
- Pybricks 펌웨어는 `Pybricks GATT Service`와 `START_REPL` / `WRITE_STDIN` 명령을 사용합니다.
- Pybricks 연결 시 UI의 속도 입력값은 내부적으로 `x10` 하여 `deg/s`로 변환합니다.
- 허브 펌웨어 상태에 따라 REPL 응답 형식이 조금 다를 수 있습니다.
