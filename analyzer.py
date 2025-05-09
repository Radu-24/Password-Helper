import sys
import string
from PyQt6.QtWidgets import (
    QApplication, QWidget, QLabel, QLineEdit,
    QVBoxLayout, QHBoxLayout, QFrame, QGraphicsOpacityEffect, QPushButton
)
from PyQt6.QtGui import (
    QFont, QIcon, QPainter, QColor, QPen, QAction
)
from PyQt6.QtCore import Qt, QRect, QPropertyAnimation


class GradientBar(QFrame):
    def __init__(self, segments=5):
        super().__init__()
        self.segments = segments
        self.setFixedHeight(20)

        # Style for the gradient bar
        self.setStyleSheet("""
            QFrame {
                background: qlineargradient(
                    x1: 0, y1: 0, x2: 1, y2: 0,
                    stop: 0 red,
                    stop: 0.5 yellow,
                    stop: 1 green
                );
                border-radius: 10px;
            }
        """
        )

        # Mask overlay to cover unmet strength
        self.mask = QFrame(self)
        self.mask.setStyleSheet(
            "background-color: rgba(43, 43, 43, 0.9);"
            "border-top-right-radius: 10px;"
            "border-bottom-right-radius: 10px;"
            "border-top-left-radius: 0px;"
            "border-bottom-left-radius: 0px;"
        )
        self.mask.setGeometry(0, 0, self.width(), self.height())

        self.anim = QPropertyAnimation(self.mask, b"geometry")
        self.anim.setDuration(200)

    def resizeEvent(self, event):
        self.update_mask(0)

    def update_mask(self, score):
        full_width = self.width()
        percent = score / self.segments
        cover_width = int(full_width * (1 - percent))
        new_x = int(full_width - cover_width)

        self.anim.stop()
        self.anim.setStartValue(self.mask.geometry())
        self.anim.setEndValue(QRect(new_x, 0, cover_width, self.height()))
        self.anim.start()

    def paintEvent(self, event):
        super().paintEvent(event)
        painter = QPainter(self)
        pen = QPen(QColor(80, 80, 80, 180))
        pen.setWidth(2)
        painter.setPen(pen)
        spacing = self.width() / self.segments
        for i in range(1, self.segments):
            x = int(i * spacing)
            painter.drawLine(x, 0, x, self.height())


class PasswordAnalyzer(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Password Analyzer 🔐")
        self.setGeometry(400, 200, 500, 400)
        self.eye_visible = False

        # Keep animations alive
        self.animations = []

        # Apply dark theme styling
        self.setStyleSheet("""
            QWidget {
                background-color: #2b2b2b;
                color: #ffffff;
            }
            QLineEdit {
                background-color: #3c3f41;
                color: #ffffff;
                border: 1px solid #555555;
                border-radius: 5px;
                padding: 6px;
            }
            QLabel#title {
                color: #f0f0f0;
            }
            QLabel {
                color: #cccccc;
            }
            QPushButton#menuBtn {
                background: transparent;
                border: none;
                color: #ffffff;
                font-size: 20px;
            }
        """
        )

        # Slide menu panel
        self.menu_panel = QFrame(self)
        self.menu_panel.setGeometry(-150, 0, 150, self.height())
        self.menu_panel.setStyleSheet("background-color: #3c3f41;")
        menu_layout = QVBoxLayout(self.menu_panel)
        for name in ("Home", "Settings", "About"):
            btn = QPushButton(name)
            btn.setStyleSheet("color: #ffffff; background: none; border: none; text-align: left; padding: 10px;")
            menu_layout.addWidget(btn)
        menu_layout.addStretch()

        # Menu (hamburger) button
        self.menu_btn = QPushButton("\u2630", self)
        self.menu_btn.setObjectName("menuBtn")
        self.menu_btn.setFixedSize(30, 30)
        self.menu_btn.move(10, 10)
        self.menu_btn.clicked.connect(self.toggle_menu)

        # Icons
        self.eye_open = QIcon("eye.png")
        self.eye_closed = QIcon("eye-slash.png")

        # Title label
        self.title_label = QLabel("🔐 Enter your password:")
        self.title_label.setObjectName("title")
        title_font = QFont("Arial", 16)
        title_font.setBold(True)
        self.title_label.setFont(title_font)
        self.title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # Password input
        self.input_field = QLineEdit()
        self.input_field.setFont(QFont("Arial", 12))
        self.input_field.setPlaceholderText("Type your password...")
        self.input_field.setEchoMode(QLineEdit.EchoMode.Password)
        self.input_field.setFixedHeight(35)
        self.eye_action = QAction(self.eye_open, "")
        self.input_field.addAction(
            self.eye_action, QLineEdit.ActionPosition.TrailingPosition
        )
        self.eye_action.triggered.connect(self.toggle_password_visibility)

        # Strength bar
        self.strength_bar = GradientBar()
        self.strength_bar.setFixedHeight(25)

        # Strength descriptor
        self.strength_label = QLabel("")
        self.strength_label.setFont(QFont("Arial", 11))
        self.strength_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # Requirements list
        self.requirements = {}
        req_texts = {
            "length": "• At least 12 characters",
            "upper": "• Add uppercase letters",
            "lower": "• Add lowercase letters",
            "digit": "• Add numbers",
            "special": "• Add special characters (!@#$...)"
        }

        # Layout setup
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(30, 50, 30, 30)
        main_layout.setSpacing(20)
        main_layout.addWidget(self.title_label)
        main_layout.addWidget(self.input_field)
        main_layout.addWidget(self.strength_bar)
        main_layout.addWidget(self.strength_label)

        for key, text in req_texts.items():
            label = QLabel(text)
            label.setFont(QFont("Arial", 10))
            opacity = QGraphicsOpacityEffect()
            label.setGraphicsEffect(opacity)
            opacity.setOpacity(1.0)
            self.requirements[key] = {"label": label, "opacity": opacity, "visible": True}
            main_layout.addWidget(label)

        # Connect text change
        self.input_field.textChanged.connect(self.live_check)

    def toggle_menu(self):
        rect = self.menu_panel.geometry()
        new_x = 0 if rect.x() < 0 else -150
        anim = QPropertyAnimation(self.menu_panel, b"geometry", self)
        anim.setDuration(300)
        anim.setStartValue(rect)
        anim.setEndValue(QRect(new_x, 0, 150, self.height()))
        anim.start()
        self.animations.append(anim)

    def toggle_password_visibility(self):
        if self.eye_visible:
            self.input_field.setEchoMode(QLineEdit.EchoMode.Password)
            self.eye_action.setIcon(self.eye_open)
        else:
            self.input_field.setEchoMode(QLineEdit.EchoMode.Normal)
            self.eye_action.setIcon(self.eye_closed)
        self.eye_visible = not self.eye_visible

    def live_check(self):
        password = self.input_field.text()
        score = 0

        def fulfill(key):
            if self.requirements[key]["visible"]:
                self.requirements[key]["visible"] = False
                fade = QPropertyAnimation(
                    self.requirements[key]["opacity"], b"opacity", self
                )
                fade.setDuration(300)
                fade.setStartValue(1.0)
                fade.setEndValue(0.0)
                fade.start()
                self.animations.append(fade)

        def unfulfill(key):
            if not self.requirements[key]["visible"]:
                self.requirements[key]["visible"] = True
                fade = QPropertyAnimation(
                    self.requirements[key]["opacity"], b"opacity", self
                )
                fade.setDuration(200)
                fade.setStartValue(0.0)
                fade.setEndValue(1.0)
                fade.start()
                self.animations.append(fade)

        # Check criteria
        if len(password) >= 12:
            score += 1
            fulfill("length")
        else:
            unfulfill("length")

        if any(c.isupper() for c in password):
            score += 1
            fulfill("upper")
        else:
            unfulfill("upper")

        if any(c.islower() for c in password):
            score += 1
            fulfill("lower")
        else:
            unfulfill("lower")

        if any(c.isdigit() for c in password):
            score += 1
            fulfill("digit")
        else:
            unfulfill("digit")

        if any(c in string.punctuation for c in password):
            score += 1
            fulfill("special")
        else:
            unfulfill("special")

        # Update gradient and descriptor
        self.strength_bar.update_mask(score)
        levels = ["Very Weak", "Weak", "Fair", "Strong", "Very Strong"]
        if score > 0:
            self.strength_label.setText(levels[score-1])
        else:
            self.strength_label.setText("")


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = PasswordAnalyzer()
    window.show()
    sys.exit(app.exec())
