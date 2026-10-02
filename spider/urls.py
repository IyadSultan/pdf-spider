from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

urlpatterns = [
    path("", views.app_page, name="app"),
    path("papers/", views.history, name="history"),
    path("accounts/register/", views.register, name="register"),
    path("accounts/login/", views.SpiderLogin.as_view(), name="login"),
    path("accounts/logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("api/ask/", views.api_ask, name="api_ask"),
    path("api/papers/", views.save_paper, name="save_paper"),
    path("api/papers/<int:pk>/", views.paper_detail, name="paper_detail"),
    path("api/papers/<int:pk>/file/", views.paper_file, name="paper_file"),
    path("api/highlights/", views.save_highlight, name="save_highlight"),
]
