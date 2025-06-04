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
    # Map the 0-5 raw score to one of the five strength levels
    strength = levels[min(score, len(levels) - 1)]
    return jsonify({
        "strength": strength,
        "score": score
    })

if __name__ == '__main__':
    app.run(port=5000)
