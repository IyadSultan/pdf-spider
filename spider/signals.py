"""When someone creates an account, also create their 10-search allowance."""
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Usage


@receiver(post_save, sender=User)
def create_usage(sender, instance, created, **kwargs):
    if created:
        Usage.objects.get_or_create(user=instance)
