"""Routes for the whole site. The spider app owns the pages people actually use."""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("spider.urls")),
]

handler404 = "spider.views.page_not_found"
handler500 = "spider.views.server_error"
