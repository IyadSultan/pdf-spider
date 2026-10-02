"""Sign-up form. Django checks that the password is long enough and not too common."""
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User


class RegisterForm(UserCreationForm):
    class Meta:
        model = User
        fields = ("username",)
        help_texts = {
            "username": "Letters, numbers, and the symbols @ . + - _ only.",
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "Username"
        self.fields["password1"].label = "Password"
        self.fields["password1"].help_text = "At least 8 characters, and not too similar to your username."
        self.fields["password2"].label = "Password again"
        self.fields["password2"].help_text = "Type the same password again."
        for field in self.fields.values():
            field.widget.attrs.setdefault("class", "form-control")
        self.fields["username"].widget.attrs["autocomplete"] = "username"
        self.fields["password1"].widget.attrs["autocomplete"] = "new-password"
        self.fields["password2"].widget.attrs["autocomplete"] = "new-password"
