import asyncio
import queue
import struct
import threading
import time
import tkinter as tk
from collections.abc import Coroutine
from concurrent.futures import Future
from dataclasses import dataclass
from tkinter import messagebox, ttk

from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice


OFFICIAL_UART_SERVICE_UUID = "0000FD02-0000-1000-8000-00805F9B34FB"
OFFICIAL_UART_RX_CHAR_UUID = "0000FD02-0001-1000-8000-00805F9B34FB"
OFFICIAL_UART_TX_CHAR_UUID = "0000FD02-0002-1000-8000-00805F9B34FB"

PYBRICKS_SERVICE_UUID = "c5f50001-8280-46da-89f4-6d8051e4aeef"
PYBRICKS_COMMAND_EVENT_UUID = "c5f50002-8280-46da-89f4-6d8051e4aeef"
PYBRICKS_HUB_CAPABILITIES_UUID = "c5f50003-8280-46da-89f4-6d8051e4aeef"

PYBRICKS_COMMAND_STOP_USER_PROGRAM = 0
PYBRICKS_COMMAND_START_REPL = 2
PYBRICKS_COMMAND_WRITE_STDIN = 6

PYBRICKS_EVENT_STATUS_REPORT = 0
PYBRICKS_EVENT_WRITE_STDOUT = 1

PYBRICKS_FEATURE_REPL = 1 << 0
OFFICIAL_WRITE_CHUNK_SIZE = 20
PYBRICKS_OK_MARKER = "__SPIKE_OK__"


@dataclass
class HubDevice:
    name: str
    address: str
    protocol: str
    ble_device: BLEDevice
    rssi: int | None = None

    def label(self) -> str:
        protocol_name = "Pybricks" if self.protocol == "pybricks" else "LEGO"
        suffix = f" | RSSI {self.rssi} dBm" if self.rssi is not None else ""
        return f"[{protocol_name}] {self.name} ({self.address}){suffix}"


class SpikePrimeBleController:
    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_event_loop, daemon=True)
        self._thread.start()
        self._client: BleakClient | None = None
        self._protocol: str | None = None
        self._notify_uuid: str | None = None
        self._rx_buffer = bytearray()
        self._pybricks_stdout = bytearray()
        self._pybricks_max_char_size = 20
        self._pybricks_feature_flags = 0
        self.log_queue: queue.Queue[str] = queue.Queue()

    @property
    def protocol_name(self) -> str:
        if self._protocol == "pybricks":
            return "Pybricks"
        if self._protocol == "lego":
            return "LEGO SPIKE"
        return "알 수 없음"

    def _run_event_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def submit(self, coro: Coroutine) -> Future:
        return asyncio.run_coroutine_threadsafe(coro, self._loop)

    async def scan(self, timeout: float = 5.0) -> list[HubDevice]:
        self.log_queue.put("블루투스 장치를 검색 중입니다...")
        discovered = await BleakScanner.discover(timeout=timeout, return_adv=True)
        devices: dict[str, HubDevice] = {}

        for address, (device, adv) in discovered.items():
            uuids = {uuid.lower() for uuid in adv.service_uuids or []}
            visible_name = device.name or adv.local_name or ""
            lower_name = visible_name.lower()

            if PYBRICKS_SERVICE_UUID.lower() in uuids or "pybricks" in lower_name:
                protocol = "pybricks"
            elif OFFICIAL_UART_SERVICE_UUID.lower() in uuids or "spike" in lower_name or "lego" in lower_name:
                protocol = "lego"
            else:
                continue

            devices[address] = HubDevice(
                name=visible_name or "SPIKE Prime",
                address=device.address,
                protocol=protocol,
                ble_device=device,
                rssi=adv.rssi,
            )

        results = sorted(devices.values(), key=lambda item: (item.protocol, item.name.lower(), item.address))
        self.log_queue.put(f"검색 완료: {len(results)}대 발견")
        return results

    async def connect(self, hub: HubDevice) -> None:
        if self._client and self._client.is_connected:
            if self._client.address == hub.address:
                self.log_queue.put("이미 선택한 허브에 연결되어 있습니다.")
                return
            await self.disconnect()

        self.log_queue.put(f"허브에 연결 중: {hub.name} ({hub.address})")
        client = BleakClient(
            hub.ble_device,
            timeout=15.0,
            disconnected_callback=self._handle_disconnect,
        )

        try:
            await client.connect()
            services = await self._get_services_with_retry(client)

            if services.get_characteristic(PYBRICKS_COMMAND_EVENT_UUID):
                await self._configure_pybricks_connection(client)
            elif services.get_characteristic(OFFICIAL_UART_TX_CHAR_UUID):
                await self._configure_official_connection(client)
            else:
                self.log_queue.put(
                    "서비스 탐색 결과: " + ", ".join(sorted(service.uuid for service in services))
                )
                raise RuntimeError(
                    "허브에는 연결되었지만 지원 대상 서비스(UUID)를 찾지 못했습니다. "
                    "다른 앱(Pybricks Code 등)이 이미 연결 중인지 확인해 주세요."
                )
        except Exception:
            if client.is_connected:
                await client.disconnect()
            raise

    async def _get_services_with_retry(self, client: BleakClient):
        last_error: Exception | None = None

        for attempt in range(4):
            try:
                await asyncio.sleep(0.35 * (attempt + 1))
                get_services = getattr(client, "get_services", None)
                if callable(get_services):
                    services = await get_services()
                else:
                    services = client.services

                if any(True for _ in services):
                    return services
            except Exception as exc:
                last_error = exc

        if last_error:
            raise RuntimeError(f"GATT 서비스 탐색에 실패했습니다: {last_error}") from last_error
        raise RuntimeError("GATT 서비스 탐색에 실패했습니다.")

    def _handle_disconnect(self, _: BleakClient) -> None:
        self.log_queue.put("BLE 연결이 종료되었습니다.")

    async def _configure_official_connection(self, client: BleakClient) -> None:
        await client.start_notify(OFFICIAL_UART_TX_CHAR_UUID, self._handle_official_notification)
        self._client = client
        self._protocol = "lego"
        self._notify_uuid = OFFICIAL_UART_TX_CHAR_UUID
        self._rx_buffer.clear()
        self._pybricks_stdout.clear()
        self.log_queue.put("공식 LEGO SPIKE UART 서비스로 연결되었습니다.")

    async def _configure_pybricks_connection(self, client: BleakClient) -> None:
        await client.start_notify(PYBRICKS_COMMAND_EVENT_UUID, self._handle_pybricks_event)
        raw = await client.read_gatt_char(PYBRICKS_HUB_CAPABILITIES_UUID)
        capability_bytes = bytes(raw)
        if len(capability_bytes) == 11:
            max_char_size, feature_flags, _, _ = struct.unpack("<HIIB", capability_bytes)
        else:
            max_char_size, feature_flags, _ = struct.unpack("<HII", capability_bytes)

        self._client = client
        self._protocol = "pybricks"
        self._notify_uuid = PYBRICKS_COMMAND_EVENT_UUID
        self._rx_buffer.clear()
        self._pybricks_stdout.clear()
        self._pybricks_max_char_size = max(20, max_char_size)
        self._pybricks_feature_flags = feature_flags

        if not (feature_flags & PYBRICKS_FEATURE_REPL):
            raise RuntimeError("이 Pybricks 허브는 REPL 기능을 제공하지 않습니다.")

        self.log_queue.put(
            f"Pybricks 허브에 연결되었습니다. 최대 패킷 {self._pybricks_max_char_size} bytes"
        )

    async def disconnect(self) -> None:
        if not self._client:
            return

        if self._client.is_connected:
            if self._notify_uuid:
                try:
                    await self._client.stop_notify(self._notify_uuid)
                except Exception:
                    pass
            await self._client.disconnect()

        self._client = None
        self._protocol = None
        self._notify_uuid = None
        self._rx_buffer.clear()
        self._pybricks_stdout.clear()
        self._pybricks_feature_flags = 0
        self._pybricks_max_char_size = 20
        self.log_queue.put("허브 연결을 해제했습니다.")

    def _handle_official_notification(self, _: int, data: bytearray) -> None:
        self._rx_buffer.extend(data)
        text = bytes(data).decode("utf-8", errors="replace")
        if text.strip():
            self.log_queue.put(f"HUB> {text.rstrip()}")

    def _handle_pybricks_event(self, _: int, data: bytearray) -> None:
        if not data:
            return

        event_type = data[0]
        payload = bytes(data[1:])
        self._rx_buffer.extend(data)

        if event_type == PYBRICKS_EVENT_WRITE_STDOUT:
            self._pybricks_stdout.extend(payload)
            text = payload.decode("utf-8", errors="replace")
            if text.strip():
                self.log_queue.put(f"HUB> {text.rstrip()}")
            return

        if event_type == PYBRICKS_EVENT_STATUS_REPORT and len(payload) >= 4:
            flags = int.from_bytes(payload[:4], "little")
            if flags & (1 << 6):
                self.log_queue.put("Pybricks 상태: 사용자 프로그램 실행 중")
            return

        self.log_queue.put(f"Pybricks 이벤트 수신: {data.hex(' ')}")

    async def run_motor(self, port: str, speed: int, degrees: int) -> str:
        if not self._client or not self._client.is_connected:
            raise RuntimeError("먼저 SPIKE Prime 허브에 연결하세요.")

        payload = self._build_motor_command(port, speed, degrees)
        self.log_queue.put(f"전송 코드: {payload}")

        if self._protocol == "pybricks":
            response = await self._send_pybricks_repl(payload)
        else:
            response = await self._send_official_raw_repl(payload)

        self.log_queue.put("모터 명령 전송이 완료되었습니다.")
        return response

    def _build_motor_command(self, port: str, speed: int, degrees: int) -> str:
        port = port.upper()
        if port not in "ABCDEF":
            raise ValueError("포트는 A~F만 선택할 수 있습니다.")
        if not -100 <= speed <= 100:
            raise ValueError("속도는 -100 ~ 100 범위여야 합니다.")

        if self._protocol == "pybricks":
            return self._build_pybricks_motor_command(port, speed, degrees)
        return self._build_official_motor_command(port, speed, degrees)

    @staticmethod
    def _build_official_motor_command(port: str, speed: int, degrees: int) -> str:
        if degrees < 0:
            degrees = abs(degrees)
            speed = -speed

        if degrees == 0:
            return f"import hub;hub.port.{port}.motor.run_at_speed({speed})"

        return f"import hub;hub.port.{port}.motor.run_for_degrees({degrees}, speed={speed})"

    @staticmethod
    def _build_pybricks_motor_command(port: str, speed: int, degrees: int) -> str:
        if speed == 0:
            return (
                "from pybricks.pupdevices import Motor;"
                "from pybricks.parameters import Port;"
                f"Motor(Port.{port}).stop();"
                f"print('{PYBRICKS_OK_MARKER}')"
            )

        pybricks_speed = max(100, abs(speed) * 10)
        signed_degrees = degrees
        if degrees > 0 and speed < 0:
            signed_degrees = -degrees
        elif degrees < 0 and speed > 0:
            signed_degrees = degrees
        elif degrees < 0 and speed < 0:
            signed_degrees = abs(degrees)

        import_line = "from pybricks.pupdevices import Motor;from pybricks.parameters import Port;"
        motor_ref = f"_m=Motor(Port.{port})"

        if degrees == 0:
            return (
                f"{import_line}{motor_ref};"
                f"_m.dc({speed});"
                f"print('{PYBRICKS_OK_MARKER}')"
            )

        return (
            f"{import_line}{motor_ref};"
            f"_m.run_angle({pybricks_speed}, {signed_degrees});"
            f"print('{PYBRICKS_OK_MARKER}')"
        )

    async def _send_official_raw_repl(self, code: str) -> str:
        self._rx_buffer.clear()
        await self._write_official_bytes(b"\r\x03\x03")
        await asyncio.sleep(0.25)
        self._rx_buffer.clear()
        await self._write_official_bytes(b"\r\x01")
        await self._wait_for_patterns([b"raw REPL", b">"], timeout=3.0)

        self._rx_buffer.clear()
        await self._write_official_bytes(code.encode("utf-8"))
        await self._write_official_bytes(b"\x04")
        await self._wait_for_patterns([b"\x04>", b"Traceback", b"OK"], timeout=5.0)
        await asyncio.sleep(0.15)
        response = bytes(self._rx_buffer)

        try:
            await self._write_official_bytes(b"\x02")
        except Exception:
            pass

        decoded = response.decode("utf-8", errors="replace").strip()
        if "Traceback" in decoded:
            raise RuntimeError(decoded)
        return decoded

    async def _send_pybricks_repl(self, code: str) -> str:
        if not (self._pybricks_feature_flags & PYBRICKS_FEATURE_REPL):
            raise RuntimeError("이 Pybricks 허브는 REPL 명령을 지원하지 않습니다.")

        self._rx_buffer.clear()
        self._pybricks_stdout.clear()

        try:
            await self._write_pybricks_command(bytes([PYBRICKS_COMMAND_STOP_USER_PROGRAM]))
            await asyncio.sleep(0.1)
        except Exception:
            pass

        await self._write_pybricks_command(bytes([PYBRICKS_COMMAND_START_REPL]))
        await self._wait_for_pybricks_prompt(timeout=4.0)

        self._pybricks_stdout.clear()
        await self._write_pybricks_stdin(b"\x03\r")
        await self._wait_for_pybricks_prompt(timeout=2.0)
        self._pybricks_stdout.clear()

        stdin_data = code.encode("utf-8")
        if not stdin_data.endswith(b"\r"):
            stdin_data += b"\r"

        await self._write_pybricks_stdin(stdin_data)
        response = await self._wait_for_pybricks_execution(timeout=8.0)

        if "Traceback" in response:
            raise RuntimeError(response.strip())
        if PYBRICKS_OK_MARKER not in response:
            raise RuntimeError(
                "Pybricks REPL 응답은 받았지만 실행 완료 마커를 찾지 못했습니다.\n"
                + response.strip()
            )
        return response.strip()

    async def _write_pybricks_command(self, payload: bytes) -> None:
        if not self._client or not self._client.is_connected:
            raise RuntimeError("BLE 연결이 끊어졌습니다.")

        await self._client.write_gatt_char(PYBRICKS_COMMAND_EVENT_UUID, payload, response=True)

    async def _write_pybricks_stdin(self, stdin_data: bytes) -> None:
        max_payload = max(1, self._pybricks_max_char_size - 1)

        for start in range(0, len(stdin_data), max_payload):
            chunk = stdin_data[start : start + max_payload]
            packet = bytes([PYBRICKS_COMMAND_WRITE_STDIN]) + chunk
            await self._write_pybricks_command(packet)
            await asyncio.sleep(0.02)

    async def _wait_for_pybricks_stdout(self, timeout: float, quiet_period: float) -> str:
        end_time = time.monotonic() + timeout
        last_change = time.monotonic()
        previous_length = len(self._pybricks_stdout)

        while time.monotonic() < end_time:
            current_length = len(self._pybricks_stdout)
            if current_length != previous_length:
                previous_length = current_length
                last_change = time.monotonic()
            elif current_length and time.monotonic() - last_change >= quiet_period:
                break

            await asyncio.sleep(0.05)

        return bytes(self._pybricks_stdout).decode("utf-8", errors="replace")

    async def _wait_for_pybricks_prompt(self, timeout: float) -> str:
        end_time = time.monotonic() + timeout
        while time.monotonic() < end_time:
            decoded = bytes(self._pybricks_stdout).decode("utf-8", errors="replace")
            if decoded.rstrip().endswith(">>>") or decoded.rstrip().endswith("..."):
                return decoded
            await asyncio.sleep(0.05)
        raise TimeoutError("Pybricks REPL 프롬프트를 기다리는 동안 시간이 초과되었습니다.")

    async def _wait_for_pybricks_execution(self, timeout: float) -> str:
        end_time = time.monotonic() + timeout
        while time.monotonic() < end_time:
            decoded = bytes(self._pybricks_stdout).decode("utf-8", errors="replace")
            if "Traceback" in decoded:
                return decoded
            if PYBRICKS_OK_MARKER in decoded and decoded.rstrip().endswith(">>>"):
                return decoded
            await asyncio.sleep(0.05)
        return bytes(self._pybricks_stdout).decode("utf-8", errors="replace")

    async def _wait_for_patterns(self, patterns: list[bytes], timeout: float) -> bytes:
        end_time = time.monotonic() + timeout
        while time.monotonic() < end_time:
            current = bytes(self._rx_buffer)
            if any(pattern in current for pattern in patterns):
                return current
            await asyncio.sleep(0.05)
        raise TimeoutError("허브 응답을 기다리는 동안 시간이 초과되었습니다.")

    async def _write_official_bytes(self, payload: bytes) -> None:
        if not self._client or not self._client.is_connected:
            raise RuntimeError("BLE 연결이 끊어졌습니다.")

        for start in range(0, len(payload), OFFICIAL_WRITE_CHUNK_SIZE):
            chunk = payload[start : start + OFFICIAL_WRITE_CHUNK_SIZE]
            await self._client.write_gatt_char(OFFICIAL_UART_RX_CHAR_UUID, chunk, response=False)
            await asyncio.sleep(0.03)

    def shutdown(self) -> None:
        future = self.submit(self.disconnect())
        try:
            future.result(timeout=3)
        except Exception:
            pass
        self._loop.call_soon_threadsafe(self._loop.stop)


class SpikePrimeApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("SPIKE Prime BLE Motor Controller")
        self.root.geometry("720x520")
        self.root.minsize(640, 460)

        self.controller = SpikePrimeBleController()
        self.discovered_devices: dict[str, HubDevice] = {}

        self.device_var = tk.StringVar()
        self.port_var = tk.StringVar(value="A")
        self.speed_var = tk.StringVar(value="50")
        self.degrees_var = tk.StringVar(value="360")
        self.status_var = tk.StringVar(value="SPIKE Prime 또는 Pybricks 허브를 검색해 주세요.")

        self._build_widgets()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(150, self._drain_logs)

    def _build_widgets(self) -> None:
        padding = {"padx": 12, "pady": 8}
        main = ttk.Frame(self.root, padding=16)
        main.pack(fill="both", expand=True)
        main.columnconfigure(0, weight=1)

        connection_frame = ttk.LabelFrame(main, text="블루투스 연결")
        connection_frame.grid(row=0, column=0, sticky="ew", **padding)
        connection_frame.columnconfigure(1, weight=1)

        ttk.Button(connection_frame, text="스캔", command=self.scan_devices).grid(
            row=0, column=0, padx=8, pady=8, sticky="w"
        )
        self.device_combo = ttk.Combobox(
            connection_frame,
            textvariable=self.device_var,
            state="readonly",
            values=[],
        )
        self.device_combo.grid(row=0, column=1, padx=8, pady=8, sticky="ew")
        ttk.Button(connection_frame, text="연결", command=self.connect_device).grid(
            row=0, column=2, padx=8, pady=8, sticky="e"
        )

        control_frame = ttk.LabelFrame(main, text="모터 제어")
        control_frame.grid(row=1, column=0, sticky="ew", **padding)
        for column in range(4):
            control_frame.columnconfigure(column, weight=1)

        ttk.Label(control_frame, text="포트").grid(row=0, column=0, padx=8, pady=8, sticky="w")
        self.port_combo = ttk.Combobox(
            control_frame,
            textvariable=self.port_var,
            state="readonly",
            values=list("ABCDEF"),
            width=8,
        )
        self.port_combo.grid(row=0, column=1, padx=8, pady=8, sticky="ew")

        ttk.Label(control_frame, text="모터 속도 (-100 ~ 100)").grid(
            row=1, column=0, padx=8, pady=8, sticky="w"
        )
        ttk.Entry(control_frame, textvariable=self.speed_var).grid(
            row=1, column=1, padx=8, pady=8, sticky="ew"
        )

        ttk.Label(control_frame, text="회전 각도 (deg)").grid(
            row=1, column=2, padx=8, pady=8, sticky="w"
        )
        ttk.Entry(control_frame, textvariable=self.degrees_var).grid(
            row=1, column=3, padx=8, pady=8, sticky="ew"
        )

        ttk.Button(control_frame, text="모터 구동", command=self.run_motor).grid(
            row=2, column=0, columnspan=4, padx=8, pady=(12, 10), sticky="ew"
        )

        note = ttk.Label(
            control_frame,
            text="Pybricks 연결 시 속도 값은 내부적으로 x10 하여 deg/s로 변환합니다.",
        )
        note.grid(row=3, column=0, columnspan=4, padx=8, pady=(0, 6), sticky="w")

        status_frame = ttk.LabelFrame(main, text="상태")
        status_frame.grid(row=2, column=0, sticky="nsew", **padding)
        status_frame.columnconfigure(0, weight=1)
        status_frame.rowconfigure(1, weight=1)
        main.rowconfigure(2, weight=1)

        ttk.Label(status_frame, textvariable=self.status_var).grid(
            row=0, column=0, padx=8, pady=(8, 4), sticky="w"
        )

        self.log_text = tk.Text(status_frame, height=12, wrap="word", state="disabled")
        self.log_text.grid(row=1, column=0, padx=8, pady=8, sticky="nsew")

    def scan_devices(self) -> None:
        self.status_var.set("스캔 중...")
        future = self.controller.submit(self.controller.scan())
        self._watch_future(future, self._handle_scan_result)

    def _handle_scan_result(self, devices: list[HubDevice]) -> None:
        self.discovered_devices = {device.label(): device for device in devices}
        labels = list(self.discovered_devices.keys())
        self.device_combo["values"] = labels
        if labels:
            self.device_var.set(labels[0])
            self.status_var.set(f"{len(labels)}개의 허브를 찾았습니다.")
        else:
            self.status_var.set("SPIKE Prime 허브를 찾지 못했습니다.")

    def connect_device(self) -> None:
        selection = self.device_var.get()
        device = self.discovered_devices.get(selection)
        if not device:
            messagebox.showwarning("선택 필요", "연결할 SPIKE Prime 허브를 먼저 선택하세요.")
            return

        self.status_var.set("허브에 연결 중...")
        future = self.controller.submit(self.controller.connect(device))
        self._watch_future(
            future,
            lambda _: self.status_var.set(f"{device.name} 연결 완료 ({self.controller.protocol_name})"),
        )

    def run_motor(self) -> None:
        try:
            speed = int(self.speed_var.get().strip())
            degrees = int(self.degrees_var.get().strip())
        except ValueError:
            messagebox.showerror("입력 오류", "속도와 회전 각도는 정수로 입력해야 합니다.")
            return

        self.status_var.set("모터 명령 전송 중...")
        future = self.controller.submit(
            self.controller.run_motor(self.port_var.get(), speed, degrees)
        )
        self._watch_future(
            future,
            lambda response: self.status_var.set(
                "명령 완료" if not response else "모터 명령이 전송되었습니다."
            ),
        )

    def _watch_future(self, future: Future, on_success) -> None:
        if future.done():
            self._finish_future(future, on_success)
            return
        self.root.after(100, lambda: self._watch_future(future, on_success))

    def _finish_future(self, future: Future, on_success) -> None:
        try:
            result = future.result()
        except Exception as exc:
            self.status_var.set("오류가 발생했습니다.")
            messagebox.showerror("실행 오류", str(exc))
            return
        on_success(result)

    def _drain_logs(self) -> None:
        while True:
            try:
                message = self.controller.log_queue.get_nowait()
            except queue.Empty:
                break
            self._append_log(message)
        self.root.after(150, self._drain_logs)

    def _append_log(self, message: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"{message}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def on_close(self) -> None:
        self.controller.shutdown()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    SpikePrimeApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
