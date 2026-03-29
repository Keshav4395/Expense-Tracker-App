from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import os
import traceback
from threading import Lock
from datetime import datetime

import predictive_expenses as model

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_user_expenses = {}
_user_analysis = {}

_model_lock = Lock()
_model_loaded = False

def load_model_once():
    global _model_loaded
    if _model_loaded:
        return
    try:
        if hasattr(model, "load_model"):
            model.load_model()
            logger.info("Model loaded")
        _model_loaded = True
    except Exception:
        logger.exception("Failed loading model")
        raise

# ----------------------------------
# HEALTH CHECK (Node backend expects this)
# ----------------------------------
@app.route("/api/ml/health", methods=["GET"])
def ml_health():
    try:
        load_model_once()
        return jsonify({"status": "ok"}), 200
    except Exception:
        return jsonify({"status": "error"}), 500

# ----------------------------------
# RECEIVE EXPENSE FROM NODE BACKEND
# ----------------------------------
@app.route("/api/ml/expense", methods=["POST"])
def receive_expense():
    try:
        payload = request.get_json(silent=True)

        if not payload:
            return jsonify({"error": "Missing body"}), 400

        user_id = payload.get("userId")
        expense = payload.get("expense")

        if not user_id or not expense:
            return jsonify({"error": "userId and expense required"}), 400

        expense.setdefault("date", datetime.utcnow().isoformat())
        expense["amount"] = float(expense.get("amount", 0))

        _user_expenses.setdefault(user_id, []).append(expense)

        return jsonify({"status": "saved"}), 200

    except Exception as e:
        logger.error("receive_expense error: %s", e)
        logger.debug(traceback.format_exc())
        return jsonify({"error": "internal_server_error"}), 500

# ----------------------------------
# RUN ANALYSIS (Node backend calls this)
# ----------------------------------
@app.route("/api/ml/analyze", methods=["POST"])
def analyze_user():
    try:
        load_model_once()

        payload = request.get_json(silent=True) or {}
        user_id = payload.get("userId")

        if not user_id:
            return jsonify({"error": "userId required"}), 400

        expenses = _user_expenses.get(user_id, [])

        if len(expenses) < 1:
            return jsonify({"error": "not_enough_expenses"}), 400

        with _model_lock:
            analysis = model.analyze_expenses(expenses)
            predictions = model.predict_next_week(expenses)

        result = {
            "analysis": analysis,
            "predictions": predictions,
            "analyzedAt": datetime.utcnow().isoformat()
        }

        _user_analysis[user_id] = result

        return jsonify(result), 200

    except Exception as e:
        logger.error("analyze_user error: %s", e)
        logger.debug(traceback.format_exc())
        return jsonify({"error": "internal_server_error"}), 500

# ----------------------------------
# FETCH RESULTS
# ----------------------------------
@app.route("/api/ml/results/<user_id>", methods=["GET"])
def get_results(user_id):
    try:
        result = _user_analysis.get(user_id)
        if not result:
            return jsonify({"error": "no_analysis"}), 404
        return jsonify(result), 200
    except Exception as e:
        logger.error("get_results error: %s", e)
        logger.debug(traceback.format_exc())
        return jsonify({"error": "internal_server_error"}), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", 3001))
    app.run(host="0.0.0.0", port=port, debug=True)
