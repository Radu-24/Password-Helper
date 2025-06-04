from flask import Flask, request, jsonify
import string

app = Flask(__name__)

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.get_json()
    password = data.get('password', '')
    score = 0

    if len(password) >= 12: score += 1
    if any(c.isupper() for c in password): score += 1
    if any(c.islower() for c in password): score += 1
    if any(c.isdigit() for c in password): score += 1
    if any(c in string.punctuation for c in password): score += 1

    levels = ["Very Weak", "Weak", "Fair", "Strong", "Very Strong"]
    return jsonify({
        "strength": levels[score - 1] if score > 0 else "Very Weak",
        "score": score
    })

if __name__ == '__main__':
    app.run(port=5000)
