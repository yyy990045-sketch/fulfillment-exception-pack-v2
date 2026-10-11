"""Loopback-only, stateless demo endpoints. No database or frontend edits."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import multiprocessing
import threading
import time
from standard import CONTRACT as STANDARD_CONTRACT, InputError, plan_standard, validate_standard

from build import CONTRACT
from decision import revise_order, revise_fleet, V2

ORIGINS = set(CONTRACT["http"]["corsOrigins"])
ENDPOINTS = {"/api/city-delivery/revise-order": revise_order, "/api/city-delivery/revise-fleet": revise_fleet,
             "/api/city-delivery/plan-scene": plan_standard,
             "/api/city-delivery/validate-scene": validate_standard}
COMPUTE_SLOTS = threading.BoundedSemaphore(2)


def compute_child(path, request, pipe):
    try:
        pipe.send((200, ENDPOINTS[path](request)))
    except (ValueError, TypeError, KeyError) as error:
        pipe.send((422, {"error": str(error), "solverStatus": "INPUT_INVALID", "field": getattr(error, "path", None), "executionMode": "request-rejected"}))
    except Exception:
        pipe.send((500, {"error": "计算服务异常，未生成可执行结论。", "solverStatus": "SERVICE_ERROR", "executable": False}))
    finally:
        pipe.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # No request bodies or customer content in logs.

    def send_json(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ready": (V2 / "scenario.json").exists(), "mode": "local-demo", "computedPerRequest": True,
                                 "scenarioIds": ["city-delivery-synthetic-001", "city-delivery-multivehicle-synthetic-001"],
                                 "acceptsStandardScenario": True, "validationEndpoint": True,
                                 "computeSlots": 2, "constraintVersion": STANDARD_CONTRACT["constraintVersion"]})
        elif self.path == "/contract":
            self.send_json(200, {**CONTRACT, "standardScenario": STANDARD_CONTRACT})
        else:
            self.send_json(404, {"error": "未找到此入口。"})

    def do_OPTIONS(self):
        if self.path not in ENDPOINTS or self.headers.get("Origin") not in ORIGINS:
            self.send_json(403, {"error": "不支持此页面来源或入口。"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        started = time.perf_counter()
        self.connection.settimeout(5)
        if self.path not in ENDPOINTS:
            self.send_json(404, {"error": "未找到此计算入口。"})
            return
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ORIGINS:
            self.send_json(403, {"error": "不支持此页面来源。"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= (262144 if self.path.endswith(("plan-scene", "validate-scene")) else CONTRACT["requestLimits"]["bodyBytes"]):
                self.send_json(413, {"error": "请求缺少内容或超过演示入口范围。"})
                return
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                self.send_json(415, {"error": "请提交 JSON 请求。"})
                return
            request = json.loads(self.rfile.read(size), parse_constant=lambda value: (_ for _ in ()).throw(ValueError("JSON 不接受 NaN 或 Infinity")))
            if not COMPUTE_SLOTS.acquire(blocking=False):
                self.send_json(503, {"solverStatus": "BUSY", "error": "两个计算槽位正在使用，请稍后重试。", "executable": False})
                return
            context = multiprocessing.get_context("spawn")
            parent, child = context.Pipe(duplex=False)
            process = context.Process(target=compute_child, args=(self.path, request, child))
            try:
                process.start()
                child.close()
                if parent.poll(8):
                    status, result = parent.recv()
                else:
                    process.terminate()
                    status, result = 504, {"solverStatus": "TIMEOUT", "error": "计算超过服务硬时限，未发布可执行计划。", "executable": False}
                result["serviceTiming"] = {"overallInterfaceMs": round((time.perf_counter()-started)*1000,3), "hardTimeoutSeconds": 8}
                self.send_json(status, result)
            finally:
                if process.is_alive(): process.terminate()
                process.join(timeout=1)
                parent.close()
                COMPUTE_SLOTS.release()
        except (ValueError, TypeError, KeyError) as error:
            self.send_json(422, {"error": str(error), "solverStatus": "INPUT_INVALID", "executionMode": "request-rejected"})
        except Exception:
            self.send_json(500, {"error": "当前计算无法完成；未生成可执行结论，请重新检查输入。", "solverStatus": "SERVICE_ERROR"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8112)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.timeout = 10
    print(f"Local city delivery decision endpoint: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
