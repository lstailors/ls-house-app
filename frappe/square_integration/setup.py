from setuptools import setup, find_packages

setup(
    name="square_integration",
    version="1.0.0",
    description="Square payment capture for ERPNext Sales Invoices",
    author="L&S Custom Tailors",
    author_email="carl@lstailors.com",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=["frappe"],
)
