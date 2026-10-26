"""Django settings for the employee management system.

Deployment-sensitive values come from the environment (see .env.example) so
the same code runs in development and production without edits.
"""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / '.env')


def env_bool(key: str, default: bool = False) -> bool:
    return os.getenv(key, str(default)).strip().lower() in {'1', 'true', 'yes', 'on'}


def env_list(key: str, default: str = '') -> list[str]:
    return [item.strip() for item in os.getenv(key, default).split(',') if item.strip()]


SECRET_KEY = os.getenv(
    'DJANGO_SECRET_KEY',
    'django-insecure-(8x_2p6r0&s!o0adeecnl-)hr9x*9e1j#fjjudau$16rdaa^3o',
)

DEBUG = env_bool('DJANGO_DEBUG', True)

ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]')


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'rest_framework',
    'corsheaders',

    'app.apps.EmployeeAppConfig',
    'tasks.apps.TasksAppConfig',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'
ASGI_APPLICATION = 'core.asgi.application'

AUTH_USER_MODEL = 'app.User'


# Database -- SQLite by default, Postgres when DB_ENGINE says so.
if os.getenv('DB_ENGINE', 'sqlite') == 'postgres':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('DB_NAME', 'employee_management'),
            'USER': os.getenv('DB_USER', 'postgres'),
            'PASSWORD': os.getenv('DB_PASSWORD', ''),
            'HOST': os.getenv('DB_HOST', 'localhost'),
            'PORT': os.getenv('DB_PORT', '5432'),
            'CONN_MAX_AGE': 60,
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }


AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


LANGUAGE_CODE = 'en-us'
TIME_ZONE = os.getenv('DJANGO_TIME_ZONE', 'Asia/Karachi')
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Camera frames are posted as multipart; keep the ceiling generous but finite.
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024


# --------------------------------------------------------------------------
# REST framework
# --------------------------------------------------------------------------

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 25,
    'DEFAULT_FILTER_BACKENDS': ['rest_framework.filters.SearchFilter'],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.ScopedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/min',
    },
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(
        minutes=int(os.getenv('JWT_ACCESS_MINUTES', '60'))
    ),
    'REFRESH_TOKEN_LIFETIME': timedelta(
        days=int(os.getenv('JWT_REFRESH_DAYS', '7'))
    ),
    'ROTATE_REFRESH_TOKENS': True,
    'UPDATE_LAST_LOGIN': True,
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
}


# --------------------------------------------------------------------------
# CORS -- the React frontend runs on a different port in development.
# --------------------------------------------------------------------------

CORS_ALLOWED_ORIGINS = env_list(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000',
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    'accept', 'authorization', 'content-type', 'origin',
    'user-agent', 'x-csrftoken', 'x-requested-with',
    'x-camera-key',  # the door cameras authenticate with this
]
CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS', '')


# --------------------------------------------------------------------------
# Face recognition
# --------------------------------------------------------------------------

# 'auto'              pick the best engine available, else the dev stub
# 'opencv'            require the OpenCV YuNet + SFace engine
# 'face_recognition'  require dlib; fail loudly if it is missing
FACE_ENGINE = os.getenv('FACE_ENGINE', 'auto')

# Minimum detector confidence for a region to count as a face at all.
FACE_DETECT_CONFIDENCE = float(os.getenv('FACE_DETECT_CONFIDENCE', '0.7'))

# 'hog' is CPU-friendly; 'cnn' is far more accurate but wants a GPU.
FACE_DETECTION_MODEL = os.getenv('FACE_DETECTION_MODEL', 'hog')

# Reject enrollment photos where the face is too small to encode reliably.
FACE_MIN_ENROLL_QUALITY = float(os.getenv('FACE_MIN_ENROLL_QUALITY', '0.08'))

# How long the in-memory template set is reused before reloading from the DB.
FACE_TEMPLATE_CACHE_SECONDS = int(os.getenv('FACE_TEMPLATE_CACHE_SECONDS', '300'))

# Guard rail: the stub must never silently run in production.
FACE_ALLOW_STUB = env_bool('FACE_ALLOW_STUB', False)


# --------------------------------------------------------------------------
# Attendance rules
# --------------------------------------------------------------------------

# Somebody standing in front of the lens must not toggle in and out.
ATTENDANCE_DUPLICATE_COOLDOWN_MINUTES = int(
    os.getenv('ATTENDANCE_DUPLICATE_COOLDOWN_MINUTES', '5')
)

# A sighting sooner than this after check-in cannot be a check-out.
ATTENDANCE_MIN_CHECKOUT_MINUTES = int(
    os.getenv('ATTENDANCE_MIN_CHECKOUT_MINUTES', '60')
)

# How long after an overnight shift ends a sighting still belongs to that
# shift's day. Leaving a little after 06:00 must not open a new day's record.
ATTENDANCE_OVERNIGHT_GRACE_MINUTES = int(
    os.getenv('ATTENDANCE_OVERNIGHT_GRACE_MINUTES', '180')
)


CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'employee-management',
    }
}

EMAIL_BACKEND = os.getenv(
    'EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend'
)

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {'format': '{levelname} {asctime} {name} {message}', 'style': '{'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'verbose'},
    },
    'root': {'handlers': ['console'], 'level': 'INFO'},
    'loggers': {
        'app': {'handlers': ['console'], 'level': 'DEBUG' if DEBUG else 'INFO',
                'propagate': False},
    },
}


# Production hardening, switched on whenever DEBUG is off.
if not DEBUG:
    SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    X_FRAME_OPTIONS = 'DENY'
